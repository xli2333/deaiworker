import { GoogleGenAI, Type } from '@google/genai';
import { MODEL_CANCEL_POLL_INTERVAL_MS, MODEL_REQUEST_TIMEOUT_MS } from './runtimeConfig.mjs';
import { loadRuntimeAssets } from './runtimeAssets.mjs';
import {
  applyFinalMarkupPlan,
  buildLocalFinalMarkupPlan,
  buildMarkupPromptBlocks,
  normalizeFinalMarkupPlan,
} from './finalMarkup.mjs';

const DEFAULT_MODEL = 'gemini-3.1-pro-preview';
const MOCK_MODEL = 'mock-gemini';
const HUMANIZER_MAX_ISSUES = 40;
const AUDIT_MAX_ISSUES = 24;
const PREVIEW_CHAR_LIMIT = 320;
const TEXT_CONTINUATION_MAX_PASSES = 4;
const TEXT_CONTINUATION_TAIL_CHARS = 2400;
const HUMANIZER_MAX_ROUNDS = 3;
const AUDIT_MAX_ROUNDS = 3;
const HUMANIZER_COLLECTION_RULE =
  '尽量穷举全文所有明显的去AI问题；同类重复问题可以合并，但必须在 diagnosis 或 excerpt 中列出多个代表片段；不要只挑前几条。';
const AUDIT_COLLECTION_RULE =
  '尽量穷举全文所有阻塞交付的问题；同类重复问题可以合并，但必须说明影响范围并给出代表片段；不要只挑前几条。';
const SPACING_POLICY_LINE =
  '中文与英文、数字默认贴排；只有汉字与英文或数字之间残留空格时才算问题，不留空格不是问题，禁止建议补空格。';
const MIXED_SPACING_RESIDUAL_REGEX = /[\u4e00-\u9fff][ \t]+[A-Za-z0-9]|[A-Za-z0-9][ \t]+[\u4e00-\u9fff]/;
const SPACING_ISSUE_KEYWORD_REGEX = /空格|混排|贴排/;
const INVERTED_SPACING_ISSUE_REGEX =
  /未留空格|没有留空格|没留空格|缺少空格|未加空格|没有加空格|没加空格|需要加空格|需要补空格|建议加空格|建议补空格|应该加空格|应该补空格/;

const HUMANIZER_REVIEW_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    summary: { type: Type.STRING },
    ready: { type: Type.STRING },
    toneGuardrail: { type: Type.STRING },
    unresolvedRisk: { type: Type.STRING },
    issues: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          category: { type: Type.STRING },
          severity: { type: Type.STRING },
          title: { type: Type.STRING },
          diagnosis: { type: Type.STRING },
          instruction: { type: Type.STRING },
          excerpt: { type: Type.STRING },
        },
      },
    },
  },
};

const HUMANIZER_ISSUES_ONLY_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    issues: HUMANIZER_REVIEW_SCHEMA.properties.issues,
  },
};

const AUDIT_REVIEW_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    summary: { type: Type.STRING },
    ready: { type: Type.STRING },
    verdict: { type: Type.STRING },
    unresolvedRisk: { type: Type.STRING },
    issues: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          scope: { type: Type.STRING },
          severity: { type: Type.STRING },
          title: { type: Type.STRING },
          diagnosis: { type: Type.STRING },
          instruction: { type: Type.STRING },
          excerpt: { type: Type.STRING },
        },
      },
    },
  },
};

const AUDIT_ISSUES_ONLY_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    issues: AUDIT_REVIEW_SCHEMA.properties.issues,
  },
};

const FINAL_MARKUP_PLAN_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    summary: { type: Type.STRING },
    transforms: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          blockIndex: { type: Type.NUMBER },
          markdown: { type: Type.STRING },
          reason: { type: Type.STRING },
        },
      },
    },
  },
};

const HUMANIZER_LOCAL_PATTERNS = [
  {
    category: '连接词',
    severity: 'medium',
    title: '模板化连接词',
    regex: /(综上所述|换句话说|更重要的是|值得注意的是|不难发现|总的来说)/,
    diagnosis: '文中仍有明显模板化过渡语。',
    instruction: '删掉套话式连接词，改成自然承接或直接陈述。',
  },
  {
    category: '黑话',
    severity: 'high',
    title: '抽象商业黑话过重',
    regex: /(赋能|闭环|底层逻辑|抓手|重新定义|范式迁移|全链路)/,
    diagnosis: '文中使用抽象黑话替代具体动作或判断。',
    instruction: '把黑话改成具体动作、结果或判断。',
  },
  {
    category: '主体',
    severity: 'medium',
    title: '模糊主体',
    regex: /(越来越多的人意识到|有人认为|业内普遍认为|不少人觉得)/,
    diagnosis: '文中使用模糊主体营造共识，削弱可交付感。',
    instruction: '删除模糊主体，或改成更克制的直接陈述。',
  },
  {
    category: '排比',
    severity: 'medium',
    title: '否定式排比',
    regex: /(不是.{0,24}而是|不仅仅是)/,
    diagnosis: '文中仍保留模型式否定排比。',
    instruction: '改成直接陈述，不保留“不是……而是……”结构。',
  },
  {
    category: '空间',
    severity: 'low',
    title: '中英或中数空格残留',
    regex: /[\u4e00-\u9fff][ \t]+[A-Za-z0-9]|[A-Za-z0-9][ \t]+[\u4e00-\u9fff]/,
    diagnosis: '中文与英文、数字默认贴排；当前片段的问题是残留了多余空格，不是未留空格。',
    instruction: '删除中文与英文、数字之间残留的多余空格，不要补空格。',
  },
  {
    category: '收束',
    severity: 'medium',
    title: '万能结尾',
    regex: /(这或许就是答案|值得每个人思考|未来已来|总而言之)/,
    diagnosis: '结尾停留在空泛收束，没有回到正文判断。',
    instruction: '删掉空泛收束，回到文中已经建立的结论。',
  },
];

const AUDIT_LOCAL_PATTERNS = [
  {
    scope: '标题',
    severity: 'medium',
    title: '缺少明确标题',
    test: (text) => !/^#\s+.+/m.test(cleanText(text)),
    diagnosis: '当前文本缺少明确标题，不利于交付与归档。',
    instruction: '补一个简洁、自然的标题。',
  },
  {
    scope: '格式',
    severity: 'low',
    title: '中英或中数空格残留',
    test: (text) => /[\u4e00-\u9fff][ \t]+[A-Za-z0-9]|[A-Za-z0-9][ \t]+[\u4e00-\u9fff]/.test(text),
    diagnosis: '中文与英文、数字默认贴排；当前片段的问题是残留了多余空格，不是未留空格。',
    instruction: '统一删除中文与英文、数字之间残留的多余空格，不要补空格。',
  },
  {
    scope: '结尾',
    severity: 'medium',
    title: '结尾仍然空泛',
    test: (text) => /(这或许就是答案|值得每个人思考|未来已来|总而言之)\s*[。！!]?$/m.test(cleanText(text)),
    diagnosis: '结尾仍停留在口号式收束，没有落回正文结论。',
    instruction: '把结尾改成对正文判断的克制收束。',
  },
];

const cleanText = (text = '') =>
  String(text)
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '')
    .trim();

const previewText = (text, limit = PREVIEW_CHAR_LIMIT) => cleanText(text).slice(0, limit);

const hasMixedSpacingResidual = (text) => MIXED_SPACING_RESIDUAL_REGEX.test(cleanText(text));

const normalizeSpacingIssueSemantics = (issue) => {
  const merged = cleanText([issue?.title, issue?.diagnosis, issue?.instruction].filter(Boolean).join('\n'));
  const excerpt = cleanText(issue?.excerpt);
  const looksLikeSpacingIssue = SPACING_ISSUE_KEYWORD_REGEX.test(merged) || hasMixedSpacingResidual(excerpt);

  if (!looksLikeSpacingIssue) {
    return issue;
  }

  const excerptHasResidual = hasMixedSpacingResidual(excerpt);
  const semanticsAreInverted = INVERTED_SPACING_ISSUE_REGEX.test(merged);

  if (semanticsAreInverted && !excerptHasResidual) {
    return null;
  }

  if (excerptHasResidual) {
    return {
      ...issue,
      title: '中英或中数空格残留',
      diagnosis: '中文与英文、数字默认贴排；当前片段的问题是残留了多余空格，不是未留空格。',
      instruction: '删除中文与英文、数字之间残留的多余空格，不要补空格。',
    };
  }

  return issue;
};

const normalizeYesNo = (value, fallback = 'no') => {
  const normalized = cleanText(value).toLowerCase();
  if (normalized === 'yes') return 'yes';
  if (normalized === 'no') return 'no';
  return fallback;
};

const normalizeVerdict = (value, fallback = 'revise') => {
  const normalized = cleanText(value).toLowerCase();
  if (normalized === 'pass') return 'pass';
  if (normalized === 'revise') return 'revise';
  return fallback;
};

const normalizeSeverity = (value, fallback = 'medium') => {
  const normalized = cleanText(value).toLowerCase();
  if (normalized === 'high' || normalized === 'critical') return 'high';
  if (normalized === 'low') return 'low';
  if (normalized === 'medium') return 'medium';
  return fallback;
};

const assertDocumentPresent = (text, label) => {
  if (!cleanText(text)) {
    throw new Error(`${label} is empty.`);
  }
};

const isMockApiKey = (apiKey) => cleanText(apiKey).toLowerCase().startsWith('mock');

const createAiClient = (apiKey) => {
  const normalized = cleanText(apiKey);
  if (!normalized) {
    throw new Error('Missing Gemini API Key.');
  }
  return new GoogleGenAI({
    apiKey: normalized,
    httpOptions: {
      timeout: MODEL_REQUEST_TIMEOUT_MS,
    },
  });
};

const createJobCanceledError = () => {
  const error = new Error('Job canceled.');
  error.code = 'JOB_CANCELED';
  return error;
};

const isAbortLikeError = (error) =>
  error?.name === 'AbortError' || error?.code === 'ABORT_ERR' || error?.code === 'ABORT_ERROR';

const isTimeoutLikeError = (error) =>
  /timed out|timeout|deadline exceeded|request timed out/i.test(cleanText(error?.message));

const buildModelRequestConfig = (baseConfig = {}, abortSignal) => ({
  ...baseConfig,
  httpOptions: {
    ...(baseConfig?.httpOptions || {}),
    timeout: MODEL_REQUEST_TIMEOUT_MS,
  },
  abortSignal,
});

const normalizeModelRequestError = (error, shouldStop) => {
  if (shouldStop?.() || error?.code === 'JOB_CANCELED') {
    return createJobCanceledError();
  }

  if (isAbortLikeError(error) || isTimeoutLikeError(error)) {
    const wrapped = new Error(`Gemini request exceeded ${MODEL_REQUEST_TIMEOUT_MS}ms timeout.`);
    wrapped.code = 'MODEL_REQUEST_TIMEOUT';
    wrapped.details = error instanceof Error ? error.message : String(error || 'Unknown timeout error');
    return wrapped;
  }

  return error instanceof Error ? error : new Error(String(error || 'Unknown model error'));
};

const isRetryableModelError = (error) =>
  !['JOB_CANCELED', 'MODEL_REQUEST_TIMEOUT', 'MODEL_OUTPUT_TRUNCATED'].includes(error?.code);

const withModelRequestControl = async ({ shouldStop, request }) => {
  if (shouldStop?.()) {
    throw createJobCanceledError();
  }

  const timeoutSignal = AbortSignal.timeout(MODEL_REQUEST_TIMEOUT_MS);
  const cancelController = new AbortController();
  const combinedSignal = AbortSignal.any([timeoutSignal, cancelController.signal]);
  const intervalId = shouldStop
    ? setInterval(() => {
        if (shouldStop()) {
          cancelController.abort(createJobCanceledError());
        }
      }, MODEL_CANCEL_POLL_INTERVAL_MS)
    : null;

  intervalId?.unref?.();

  try {
    return await request(combinedSignal);
  } catch (error) {
    throw normalizeModelRequestError(error, shouldStop);
  } finally {
    if (intervalId) {
      clearInterval(intervalId);
    }
  }
};

const callWithRetry = async (fn, retries = 3, delayMs = 1200) => {
  let lastError = null;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error || 'Unknown model error'));
      if (attempt === retries - 1 || !isRetryableModelError(lastError)) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError || 'Unknown model error'));
};

const REFERENCE_HEADER_PATTERN = /^(参考文献|参考资料|资料来源|references?)$/i;
const REFERENCE_ITEM_PATTERN = /^\[\d+\]\s*/;

const splitDocumentForReview = (text) => {
  const normalized = cleanText(text);
  if (!normalized) {
    return { diagnosticText: '', referencesText: '' };
  }

  const lines = normalized.split('\n');
  let splitIndex = -1;

  for (let index = 0; index < lines.length; index += 1) {
    if (REFERENCE_HEADER_PATTERN.test(lines[index].trim())) {
      splitIndex = index;
      break;
    }
  }

  if (splitIndex < 0) {
    const startIndex = Math.floor(lines.length * 0.55);
    for (let index = startIndex; index < lines.length; index += 1) {
      if (!REFERENCE_ITEM_PATTERN.test(lines[index].trim())) continue;
      const window = lines.slice(index, Math.min(lines.length, index + 10));
      const referenceHits = window.filter((line) => REFERENCE_ITEM_PATTERN.test(line.trim())).length;
      if (referenceHits >= 3) {
        splitIndex = index;
        break;
      }
    }
  }

  if (splitIndex < 0) {
    return { diagnosticText: normalized, referencesText: '' };
  }

  return {
    diagnosticText: cleanText(lines.slice(0, splitIndex).join('\n')),
    referencesText: cleanText(lines.slice(splitIndex).join('\n')),
  };
};

const getDiagnosticDraft = (text) => splitDocumentForReview(text).diagnosticText || cleanText(text);

const buildLintSummary = (text) => {
  const findings = HUMANIZER_LOCAL_PATTERNS.flatMap((pattern) => {
    const matches = cleanText(text).match(new RegExp(pattern.regex.source, 'g'));
    return matches && matches.length > 0 ? [`- ${pattern.title}: ${matches.length}`] : [];
  });

  return findings.length > 0 ? ['## 本地风格检查', ...findings].join('\n') : '## 本地风格检查\n- 未发现明显套话';
};

const applyDeterministicTextPolish = (text) =>
  cleanText(text)
    .replace(/[\u4e00-\u9fff][ \t]+([A-Za-z0-9])/g, (full, tail) => full.replace(/[ \t]+/, '').replace(/([A-Za-z0-9])$/, tail))
    .replace(/([A-Za-z0-9])[ \t]+([\u4e00-\u9fff])/g, '$1$2')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();

const applyFinalPolishLocally = (text) =>
  applyDeterministicTextPolish(text)
    .replace(/(?:综上所述|总而言之|总的来说)[，、:\s]*/g, '')
    .replace(/(值得每个人思考|这或许就是答案|未来已来)\s*[。！!]?$/g, '')
    .replace(/[，、；:\s]+$/g, '')
    .trim();

const extractFirstMatch = (text, regex) => {
  const match = cleanText(text).match(regex);
  return match ? cleanText(match[0]) : '';
};

const normalizeHumanizerIssues = (issues = []) =>
  (Array.isArray(issues) ? issues : [])
    .map((issue) => ({
      category: cleanText(issue?.category) || '表达',
      severity: normalizeSeverity(issue?.severity),
      title: cleanText(issue?.title) || '未命名问题',
      diagnosis: cleanText(issue?.diagnosis),
      instruction: cleanText(issue?.instruction),
      excerpt: cleanText(issue?.excerpt),
    }))
    .map((issue) => normalizeSpacingIssueSemantics(issue))
    .filter(Boolean)
    .filter((issue) => issue.title)
    .slice(0, HUMANIZER_MAX_ISSUES);

const normalizeAuditIssues = (issues = []) =>
  (Array.isArray(issues) ? issues : [])
    .map((issue) => ({
      scope: cleanText(issue?.scope) || '正文',
      severity: normalizeSeverity(issue?.severity),
      title: cleanText(issue?.title) || '未命名问题',
      diagnosis: cleanText(issue?.diagnosis),
      instruction: cleanText(issue?.instruction),
      excerpt: cleanText(issue?.excerpt),
    }))
    .map((issue) => normalizeSpacingIssueSemantics(issue))
    .filter(Boolean)
    .filter((issue) => issue.title)
    .slice(0, AUDIT_MAX_ISSUES);

const normalizeHumanizerReport = (report = {}) => {
  const issues = normalizeHumanizerIssues(report?.issues);
  const ready = issues.length === 0 ? 'yes' : 'no';
  return {
    summary: cleanText(report?.summary),
    ready,
    toneGuardrail: cleanText(report?.toneGuardrail),
    unresolvedRisk: ready === 'yes' ? '' : cleanText(report?.unresolvedRisk),
    issues,
  };
};

const normalizeAuditReport = (report = {}) => {
  const issues = normalizeAuditIssues(report?.issues);
  const approved = issues.length === 0;
  return {
    summary: cleanText(report?.summary),
    ready: approved ? 'yes' : 'no',
    verdict: approved ? 'pass' : 'revise',
    unresolvedRisk: approved ? '' : cleanText(report?.unresolvedRisk),
    issues,
  };
};

const isHumanizerReady = (report = {}) => normalizeHumanizerReport(report).ready === 'yes';

const isAuditApproved = (report = {}) => normalizeAuditReport(report).verdict === 'pass';

const attachParseMeta = (report, meta) => ({
  ...report,
  parseMeta: meta,
});

const formatIssuesMarkdown = (issues = [], kind) =>
  issues.length === 0
    ? '- 问题：无'
    : issues
        .map((issue, index) =>
          [
            `${index + 1}. ${issue.title} [${issue.severity}]`,
            `   范围：${cleanText(issue.category || issue.scope || kind || '正文') || '正文'}`,
            issue.diagnosis ? `   判断：${issue.diagnosis}` : '',
            issue.instruction ? `   修订：${issue.instruction}` : '',
            issue.excerpt ? `   片段：${issue.excerpt}` : '',
          ]
            .filter(Boolean)
            .join('\n')
        )
        .join('\n');

const formatHumanizerReportMarkdown = (report, title = '去AI审查') =>
  [
    `# ${title}`,
    '',
    `- summary: ${cleanText(report?.summary) || '无'}`,
    `- ready: ${cleanText(report?.ready) || 'no'}`,
    `- toneGuardrail: ${cleanText(report?.toneGuardrail) || '无'}`,
    `- unresolvedRisk: ${cleanText(report?.unresolvedRisk) || '无'}`,
    `- parserStatus: ${cleanText(report?.parseMeta?.parserStatus) || 'unknown'}`,
    `- parserError: ${cleanText(report?.parseMeta?.parserError) || 'none'}`,
    '',
    '## Issues',
    formatIssuesMarkdown(report?.issues, '表达'),
  ].join('\n');

const formatAuditReportMarkdown = (report, title = '最终审计') =>
  [
    `# ${title}`,
    '',
    `- summary: ${cleanText(report?.summary) || '无'}`,
    `- ready: ${cleanText(report?.ready) || 'no'}`,
    `- verdict: ${cleanText(report?.verdict) || 'revise'}`,
    `- unresolvedRisk: ${cleanText(report?.unresolvedRisk) || '无'}`,
    `- parserStatus: ${cleanText(report?.parseMeta?.parserStatus) || 'unknown'}`,
    `- parserError: ${cleanText(report?.parseMeta?.parserError) || 'none'}`,
    '',
    '## Issues',
    formatIssuesMarkdown(report?.issues, '正文'),
  ].join('\n');

const analyzeHumanizerLocally = (text) => {
  const normalized = cleanText(text);
  const issues = HUMANIZER_LOCAL_PATTERNS.map((pattern) => {
    const excerpt = extractFirstMatch(normalized, pattern.regex);
    if (!excerpt) return null;
    return {
      category: pattern.category,
      severity: pattern.severity,
      title: pattern.title,
      diagnosis: pattern.diagnosis,
      instruction: pattern.instruction,
      excerpt,
    };
  }).filter(Boolean);

  return normalizeHumanizerReport({
    summary: issues.length > 0 ? `检测到 ${issues.length} 个明显的去AI问题。` : '未检测到明显残留 AI 痕迹。',
    ready: issues.length > 0 ? 'no' : 'yes',
    toneGuardrail: '保持成熟中文编辑语体，不把商业文稿洗成口语随笔。',
    unresolvedRisk: issues.length > 0 ? '仍有套话、黑话或空泛收束需要修订。' : '',
    issues,
  });
};

const analyzeAuditLocally = (text) => {
  const normalized = cleanText(text);
  const issues = AUDIT_LOCAL_PATTERNS.map((pattern) => {
    if (!pattern.test(normalized)) return null;
    return {
      scope: pattern.scope,
      severity: pattern.severity,
      title: pattern.title,
      diagnosis: pattern.diagnosis,
      instruction: pattern.instruction,
      excerpt: previewText(normalized, 120),
    };
  }).filter(Boolean);

  return normalizeAuditReport({
    summary: issues.length > 0 ? `仍有 ${issues.length} 个交付阻塞问题。` : '当前文本已达到基础可交付状态。',
    ready: issues.length > 0 ? 'no' : 'yes',
    verdict: issues.length > 0 ? 'revise' : 'pass',
    unresolvedRisk: issues.length > 0 ? '标题、收束或格式仍需收紧。' : '',
    issues,
  });
};

const applyBasicHumanizerFixes = (text) =>
  applyDeterministicTextPolish(text)
    .replace(/(?:综上所述|总的来说|总而言之|换句话说|更重要的是|值得注意的是)[，、:\s]*/g, '')
    .replace(/越来越多的人意识到/g, '')
    .replace(/不仅仅是/g, '')
    .replace(/重新定义/g, '改写')
    .replace(/底层逻辑/g, '核心逻辑')
    .replace(/赋能/g, '支持')
    .replace(/闭环/g, '完整流程')
    .replace(/抓手/g, '着力点')
    .replace(/(值得每个人思考|这或许就是答案|未来已来)\s*[。！!]?$/g, '')
    .trim();

const applyAuditFixes = (text, fileName) => {
  let next = applyDeterministicTextPolish(text);
  if (!/^#\s+.+/m.test(next)) {
    const title = cleanText(String(fileName || '').replace(/\.[^.]+$/, '')) || '文档终稿';
    next = `# ${title}\n\n${next}`;
  }
  return next.replace(/(值得每个人思考|这或许就是答案|未来已来)\s*[。！!]?$/g, '').trim();
};

const stripMarkdownCodeFence = (text) =>
  cleanText(text)
    .replace(/^```(?:markdown|md)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

const deriveMarkdownTitle = (fileName) =>
  cleanText(String(fileName || '').replace(/\.[^.]+$/, ''))
    .replace(/[_-]+/g, ' ')
    .trim() || '文档终稿';

const normalizeMarkdownStructureLine = (line) => {
  const trimmed = cleanText(line);
  if (!trimmed) return '';
  if (
    /^#{1,6}\s+/.test(trimmed) ||
    /^[-*+]\s+/.test(trimmed) ||
    /^\d+\.\s+/.test(trimmed) ||
    /^\|/.test(trimmed) ||
    /^> ?/.test(trimmed) ||
    /^```/.test(trimmed)
  ) {
    return trimmed;
  }
  if (/^[一二三四五六七八九十]+、/.test(trimmed)) {
    return `## ${trimmed}`;
  }
  if (/^（[一二三四五六七八九十]+）/.test(trimmed)) {
    return `### ${trimmed}`;
  }
  if (/^(结论|结语|附录|参考资料|参考文献)\b/.test(trimmed)) {
    return `## ${trimmed}`;
  }
  return trimmed;
};

const addMarkdownBlockSpacing = (lines) => {
  const normalizedLines = [];
  let inFence = false;

  const pushBlankLine = () => {
    if (normalizedLines.length > 0 && normalizedLines[normalizedLines.length - 1] !== '') {
      normalizedLines.push('');
    }
  };

  for (const rawLine of lines) {
    const line = String(rawLine || '').replace(/[ \t]+$/g, '');
    const trimmed = line.trim();

    if (/^```/.test(trimmed)) {
      pushBlankLine();
      normalizedLines.push(trimmed);
      inFence = !inFence;
      continue;
    }

    if (inFence) {
      normalizedLines.push(line);
      continue;
    }

    if (!trimmed) {
      pushBlankLine();
      continue;
    }

    const isHeading = /^#{1,6}\s+/.test(trimmed);
    const isListItem = /^[-*+]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed);
    const isTableLine = /^\|/.test(trimmed);

    if (isHeading) {
      pushBlankLine();
      normalizedLines.push(trimmed);
      normalizedLines.push('');
      continue;
    }

    const previousLine = normalizedLines[normalizedLines.length - 1] || '';
    const previousIsListItem = /^[-*+]\s+/.test(previousLine) || /^\d+\.\s+/.test(previousLine);
    const previousIsTableLine = /^\|/.test(previousLine);

    if (isListItem && !previousIsListItem && previousLine !== '') {
      normalizedLines.push('');
    }
    if (isTableLine && !previousIsTableLine && previousLine !== '') {
      normalizedLines.push('');
    }

    normalizedLines.push(trimmed);
  }

  while (normalizedLines[0] === '') {
    normalizedLines.shift();
  }
  while (normalizedLines[normalizedLines.length - 1] === '') {
    normalizedLines.pop();
  }

  return normalizedLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
};

const formatFinalMarkdownDocument = (text, fileName) => {
  const title = deriveMarkdownTitle(fileName);
  const content = stripMarkdownCodeFence(applyFinalPolishLocally(text));
  const normalizedLines = content.split('\n').map((line, index) => {
    const trimmed = cleanText(line);
    if (!trimmed) return '';
    if (index === 0 && /^#\s+/.test(trimmed)) {
      return `# ${cleanText(trimmed.replace(/^#\s+/, '')) || title}`;
    }
    return normalizeMarkdownStructureLine(trimmed);
  });

  let markdown = addMarkdownBlockSpacing(normalizedLines);
  if (!/^#\s+.+/m.test(markdown)) {
    markdown = `# ${title}\n\n${markdown}`;
  }
  return markdown.trim();
};

const buildIssueSignature = (report) =>
  JSON.stringify(
    (Array.isArray(report?.issues) ? report.issues : []).map((issue) => ({
      title: cleanText(issue?.title),
      severity: cleanText(issue?.severity),
      group: cleanText(issue?.category || issue?.scope),
      instruction: cleanText(issue?.instruction),
    }))
  );

const buildRoundStageLabel = (baseLabel, round) => (round > 1 ? `${baseLabel}（第 ${round} 轮）` : baseLabel);

const shouldContinueRefinement = ({
  previousText,
  nextText,
  previousReport,
  nextReport,
  nextRound,
  maxRounds,
  isApproved,
}) => {
  if (nextRound >= maxRounds) return false;
  if (cleanText(previousText) === cleanText(nextText)) return false;
  if (!Array.isArray(nextReport?.issues) || nextReport.issues.length === 0) return false;
  if (isApproved?.(nextReport)) return false;
  return buildIssueSignature(previousReport) !== buildIssueSignature(nextReport);
};

const runRefinementLoop = async ({
  maxRounds,
  initialText,
  initialStageKey,
  initialStageLabel,
  initialStatusMessage,
  reviseStageKey,
  reviseStatusMessage,
  recheckStageKey,
  recheckStageLabel,
  recheckStatusMessage,
  reviewDraft,
  reviseDraft,
  isApproved,
  onStatus,
  onReviewState,
  shouldStop,
}) => {
  const throwIfStopped = () => {
    if (shouldStop?.()) {
      throw createJobCanceledError();
    }
  };

  throwIfStopped();
  onStatus?.(initialStageKey, initialStatusMessage(1));
  const initialReport = await reviewDraft({
    draft: initialText,
    round: 1,
    stageLabel: buildRoundStageLabel(initialStageLabel, 1),
  });
  emitReviewState(onReviewState, initialStageKey, buildRoundStageLabel(initialStageLabel, 1), initialReport);

  let currentText = initialText;
  let currentReport = initialReport;
  let round = 1;

  while (!isApproved(currentReport) && currentReport.issues.length > 0 && round < maxRounds) {
    const nextRound = round + 1;

    throwIfStopped();
    onStatus?.(reviseStageKey, reviseStatusMessage(nextRound));
    const revisedText = await reviseDraft({
      draft: currentText,
      report: currentReport,
      round: nextRound,
    });

    throwIfStopped();
    onStatus?.(recheckStageKey, recheckStatusMessage(nextRound));
    const nextReport = await reviewDraft({
      draft: revisedText,
      round: nextRound,
      stageLabel: buildRoundStageLabel(recheckStageLabel, nextRound),
    });
    emitReviewState(onReviewState, recheckStageKey, buildRoundStageLabel(recheckStageLabel, nextRound), nextReport);

    const shouldContinue = shouldContinueRefinement({
      previousText: currentText,
      nextText: revisedText,
      previousReport: currentReport,
      nextReport,
      nextRound,
      maxRounds,
      isApproved,
    });

    currentText = revisedText;
    currentReport = nextReport;
    round = nextRound;

    if (!shouldContinue) {
      break;
    }
  }

  return {
    initialReport,
    finalReport: currentReport,
    finalText: currentText,
    roundsUsed: round,
  };
};

const stripCodeFence = (text) =>
  cleanText(text)
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

const extractBalancedJsonObject = (text) => {
  const source = cleanText(text);
  const start = source.indexOf('{');
  if (start < 0) return '';

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) {
      return source.slice(start, index + 1);
    }
  }
  return source.slice(start);
};

const repairCommonJsonDamage = (text) => {
  const source = cleanText(text);
  let result = '';
  const closers = [];
  let inString = false;
  let escaped = false;

  for (const char of source) {
    if (inString) {
      if (escaped) {
        result += char;
        escaped = false;
        continue;
      }
      if (char === '\\') {
        result += char;
        escaped = true;
        continue;
      }
      if (char === '\n' || char === '\r') {
        result += '\\n';
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      result += char;
      continue;
    }

    if (char === '"') {
      inString = true;
      result += char;
      continue;
    }

    if (char === '{') closers.push('}');
    if (char === '[') closers.push(']');
    if (char === '}' || char === ']') {
      if (closers[closers.length - 1] === char) {
        closers.pop();
        result += char;
      }
      continue;
    }

    result += char;
  }

  if (inString) result += '"';
  while (closers.length > 0) {
    result += closers.pop();
  }
  return result;
};

const tryParseJsonCandidate = (text) => {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return { ok: false, error };
  }
};

const tryParseJsonResponse = (text) => {
  const cleaned = cleanText(text);
  const stripped = stripCodeFence(cleaned);
  const extracted = extractBalancedJsonObject(stripped);
  const candidates = [cleaned, stripped, extracted, repairCommonJsonDamage(extracted || stripped || cleaned)]
    .map((item) => cleanText(item))
    .filter(Boolean);

  const seen = new Set();
  let lastError = null;

  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    const parsed = tryParseJsonCandidate(candidate);
    if (parsed.ok) {
      return {
        ok: true,
        value: parsed.value,
        parserStatus:
          candidate === cleaned || candidate === stripped
            ? 'direct'
            : candidate === extracted
              ? 'extracted'
              : 'heuristic',
      };
    }
    lastError = parsed.error;
  }

  return { ok: false, error: lastError || new Error('Unable to parse structured JSON response.') };
};

const summarizeParserError = (error) =>
  cleanText(error?.message) || (error instanceof Error ? error.name : String(error || 'Unknown parser error'));

const repairStructuredJson = async ({ ai, model, stageLabel, rawText, schema, shouldStop }) =>
  await buildJsonPrompt({
    ai,
    model,
    shouldStop,
    prompt: [
      `阶段：${stageLabel}`,
      '下面是一段原本应该是 JSON 的模型输出，但它可能被截断或局部损坏。',
      '请只根据已有内容，把它恢复成一个合法 JSON 对象。',
      '不要扩写不存在的判断。缺失字段请保守补全：字符串为空字符串，数组为空数组，ready 用 no，verdict 用 revise。',
      '原始输出：',
      cleanText(rawText),
    ].join('\n\n'),
    systemInstruction: '你是 JSON 修复器。只输出合法 JSON，不输出解释。',
    schema,
  });

const buildHumanizerFallbackReport = (stageLabel, rawText, parseError) =>
  normalizeHumanizerReport({
    summary: `${stageLabel} 的结构化输出解析失败，已回退到保守报告。`,
    ready: 'no',
    toneGuardrail: '保持成熟中文编辑语体，不做口语化改写。',
    unresolvedRisk: `${stageLabel} 返回的 JSON 不完整或已损坏。`,
    issues: [
      {
        category: '结构化输出',
        severity: 'high',
        title: '去AI审查 JSON 损坏',
        diagnosis: `${stageLabel} 返回的结构化 JSON 解析失败：${summarizeParserError(parseError)}`,
        instruction: '重新执行当前审查，或按最小必要修改原则清理套话、黑话与空泛结尾。',
        excerpt: previewText(rawText),
      },
    ],
  });

const buildAuditFallbackReport = (stageLabel, rawText, parseError) =>
  normalizeAuditReport({
    summary: `${stageLabel} 的结构化输出解析失败，已回退到保守报告。`,
    ready: 'no',
    verdict: 'revise',
    unresolvedRisk: `${stageLabel} 返回的 JSON 不完整或已损坏。`,
    issues: [
      {
        scope: '结构化输出',
        severity: 'high',
        title: '审计 JSON 损坏',
        diagnosis: `${stageLabel} 返回的结构化 JSON 解析失败：${summarizeParserError(parseError)}`,
        instruction: '重新执行当前审计，或优先解决结构、标题、收束与格式问题。',
        excerpt: previewText(rawText),
      },
    ],
  });

const parseStageJsonResponse = async ({ ai, model, stageLabel, rawText, schema, buildFallback, shouldStop }) => {
  const direct = tryParseJsonResponse(rawText);
  if (direct.ok) {
    return {
      data: direct.value,
      meta: {
        parserStatus: direct.parserStatus,
        parserError: '',
        rawPreview: previewText(rawText),
      },
    };
  }

  let repairError = null;
  try {
    const repairedRaw = await repairStructuredJson({
      ai,
      model,
      stageLabel,
      rawText,
      schema,
      shouldStop,
    });
    const repaired = tryParseJsonResponse(repairedRaw);
    if (repaired.ok) {
      return {
        data: repaired.value,
        meta: {
          parserStatus: 'repaired',
          parserError: summarizeParserError(direct.error),
          rawPreview: previewText(rawText),
        },
      };
    }
    repairError = repaired.error;
  } catch (error) {
    repairError = error;
  }

  return {
    data: buildFallback(stageLabel, rawText, repairError || direct.error),
    meta: {
      parserStatus: 'fallback',
      parserError: summarizeParserError(repairError || direct.error),
      rawPreview: previewText(rawText),
    },
  };
};

const buildReviewState = (stageKey, stageLabel, report) => ({
  stageKey,
  stageLabel,
  summary: cleanText(report?.summary) || `${stageLabel} 完成。`,
  ready: cleanText(report?.ready) || undefined,
  verdict: cleanText(report?.verdict) || undefined,
  unresolvedRisk: cleanText(report?.unresolvedRisk) || undefined,
  parserStatus: cleanText(report?.parseMeta?.parserStatus) || undefined,
  parserError: cleanText(report?.parseMeta?.parserError) || undefined,
  issues: Array.isArray(report?.issues) ? report.issues : [],
});

const emitReviewState = (onReviewState, stageKey, stageLabel, report) => {
  onReviewState?.(buildReviewState(stageKey, stageLabel, report));
};

const getPrimaryCandidate = (response) =>
  Array.isArray(response?.candidates) && response.candidates.length > 0 ? response.candidates[0] : null;

const getFinishReason = (response) => cleanText(getPrimaryCandidate(response)?.finishReason);

const mergeContinuationText = (previousText, nextText) => {
  const previous = String(previousText || '');
  const next = String(nextText || '');

  if (!previous) return next;
  if (!next) return previous;
  if (previous.includes(next)) return previous;
  if (next.includes(previous)) return next;

  const maxOverlap = Math.min(previous.length, next.length, TEXT_CONTINUATION_TAIL_CHARS);
  for (let size = maxOverlap; size >= 8; size -= 1) {
    if (previous.slice(-size) === next.slice(0, size)) {
      return `${previous}${next.slice(size)}`;
    }
  }

  const previousLines = previous.split('\n');
  const nextLines = next.split('\n');
  const maxLineOverlap = Math.min(previousLines.length, nextLines.length, 12);
  for (let count = maxLineOverlap; count >= 1; count -= 1) {
    const previousTail = previousLines.slice(-count).map((line) => line.trim());
    const nextHead = nextLines.slice(0, count).map((line) => line.trim());
    if (previousTail.every((line, index) => line === nextHead[index])) {
      return [...previousLines, ...nextLines.slice(count)].join('\n');
    }
  }

  return `${previous}${next}`;
};

const buildJsonPrompt = async ({ ai, prompt, systemInstruction, schema, model, shouldStop }) => {
  const response = await callWithRetry(() =>
    withModelRequestControl({
      shouldStop,
      request: (abortSignal) =>
        ai.models.generateContent({
          model,
          contents: [prompt],
          config: buildModelRequestConfig(
            {
              systemInstruction,
              responseMimeType: 'application/json',
              responseSchema: schema,
              temperature: 0.1,
              maxOutputTokens: 5000,
            },
            abortSignal
          ),
        }),
    })
  );

  return response.text || '';
};

const buildTextPrompt = async ({
  ai,
  prompt,
  systemInstruction,
  model,
  maxOutputTokens = 14000,
  shouldStop,
}) => {
  let aggregatedText = '';
  let requestPrompt = prompt;

  for (let pass = 0; pass < TEXT_CONTINUATION_MAX_PASSES; pass += 1) {
    const response = await callWithRetry(() =>
      withModelRequestControl({
        shouldStop,
        request: (abortSignal) =>
          ai.models.generateContent({
            model,
            contents: [requestPrompt],
            config: buildModelRequestConfig(
              {
                systemInstruction,
                temperature: 0.1,
                maxOutputTokens,
              },
              abortSignal
            ),
          }),
      })
    );

    aggregatedText = mergeContinuationText(aggregatedText, cleanText(response.text || ''));
    if (getFinishReason(response) !== 'MAX_TOKENS') {
      return cleanText(aggregatedText);
    }

    requestPrompt = [
      '你上一轮输出因为达到最大输出长度而中断。',
      '保持与上一轮完全相同的任务和文体要求。',
      '不要从头重写，不要重复已经输出过的内容，不要加说明。',
      '只从中断处继续输出剩余部分，直到全文结束。',
      '原始任务：',
      prompt,
      '上一轮已输出内容的尾部片段：',
      aggregatedText.slice(-TEXT_CONTINUATION_TAIL_CHARS),
    ].join('\n\n');
  }

  const error = new Error('Model output kept hitting MAX_TOKENS and remained incomplete.');
  error.code = 'MODEL_OUTPUT_TRUNCATED';
  error.details = aggregatedText.slice(-TEXT_CONTINUATION_TAIL_CHARS);
  throw error;
};

const shouldRecoverHumanizerIssues = (rawReport, normalizedReport) =>
  normalizeYesNo(rawReport?.ready) === 'no' &&
  Array.isArray(normalizedReport?.issues) &&
  normalizedReport.issues.length === 0;

const shouldRecoverAuditIssues = (rawReport, normalizedReport) =>
  (normalizeYesNo(rawReport?.ready) === 'no' || normalizeVerdict(rawReport?.verdict) === 'revise') &&
  Array.isArray(normalizedReport?.issues) &&
  normalizedReport.issues.length === 0;

const recoverHumanizerIssues = async ({ ai, model, fileName, draft, report, shouldStop }) => {
  const diagnosticDraft = getDiagnosticDraft(draft);
  const raw = await buildJsonPrompt({
    ai,
    model,
    shouldStop,
    systemInstruction:
      '你是中文商业文稿去AI问题提取器。只输出基于正文的具体问题数组。不做事实核验，不评价参考文献真假，不评价日期和链接真实性。',
    schema: HUMANIZER_ISSUES_ONLY_SCHEMA,
    prompt: [
      `文档名：${fileName}`,
      '下面是一份已经生成过摘要的去AI诊断结果，但 issues 数组缺失。',
      HUMANIZER_COLLECTION_RULE,
      SPACING_POLICY_LINE,
      `问题上限：${HUMANIZER_MAX_ISSUES} 个聚合问题。`,
      '每个问题都必须对应正文中的真实片段。',
      '只关心套话、黑话、模糊主体、中英中数残留空格、万能收束、机械英文补充等去AI问题。',
      '已有摘要：',
      report.summary || '无',
      '已有风险说明：',
      report.unresolvedRisk || '无',
      '正文：',
      diagnosticDraft,
    ].join('\n\n'),
  });

  const parsed = tryParseJsonResponse(raw);
  return parsed.ok ? normalizeHumanizerIssues(parsed.value?.issues) : [];
};

const recoverAuditIssues = async ({ ai, model, fileName, draft, report, shouldStop }) => {
  const diagnosticDraft = getDiagnosticDraft(draft);
  const raw = await buildJsonPrompt({
    ai,
    model,
    shouldStop,
    systemInstruction:
      '你是中文商业文稿最终审计问题提取器。只输出基于正文的交付阻塞问题数组。不做事实核验，不评价参考文献真假，不评价日期和链接真实性。',
    schema: AUDIT_ISSUES_ONLY_SCHEMA,
    prompt: [
      `文档名：${fileName}`,
      '下面是一份已经生成过摘要的最终审计结果，但 issues 数组缺失。',
      AUDIT_COLLECTION_RULE,
      SPACING_POLICY_LINE,
      `问题上限：${AUDIT_MAX_ISSUES} 个聚合问题。`,
      '只关心标题、结构、收束、格式、残留 AI 腔、残留空格和可交付性问题。',
      '已有摘要：',
      report.summary || '无',
      '已有风险说明：',
      report.unresolvedRisk || '无',
      '正文：',
      diagnosticDraft,
    ].join('\n\n'),
  });

  const parsed = tryParseJsonResponse(raw);
  return parsed.ok ? normalizeAuditIssues(parsed.value?.issues) : [];
};

const reviewHumanizerPass = async ({ ai, model, fileName, draft, assets, stageLabel, shouldStop }) => {
  const diagnosticDraft = getDiagnosticDraft(draft);
  const prompt = [
    `文档名：${fileName}`,
    '以下是当前项目固定的去AI规则：',
    'anti_ai_style_rules.md：',
    assets.antiAiStyleRules,
    'commercial_humanizer_rules.md：',
    assets.commercialHumanizerRules,
    'commercial_humanizer_patterns.md：',
    assets.commercialHumanizerPatterns,
    'commercial_humanizer_quick_checks.md：',
    assets.commercialHumanizerQuickChecks,
    'humanizer_zh_reference.md：',
    assets.humanizerReference,
    '你现在是中文商业文稿去AI编辑。',
    '任务是识别残余 AI 痕迹和模板化表达，而不是把文章改成口语、随笔或聊天体。',
    '不要做事实核验，不要质疑年份真假，不要评价参考文献、URL 或访问日期。',
    '如果文末存在参考文献、链接列表或引用清单，只把它们视为附录，不作为去AI问题的主要来源。',
    SPACING_POLICY_LINE,
    HUMANIZER_COLLECTION_RULE,
    `问题上限：${HUMANIZER_MAX_ISSUES} 个聚合问题。`,
    '返回 JSON 对象，字段必须为：summary, ready, toneGuardrail, unresolvedRisk, issues。',
    'ready 只能是 yes 或 no。如果 ready 为 no，issues 不能为空。',
    buildLintSummary(diagnosticDraft),
    '正文：',
    diagnosticDraft,
  ].join('\n\n');

  const raw = await buildJsonPrompt({
    ai,
    model,
    prompt,
    shouldStop,
    systemInstruction: '你是中文商业文稿去AI编辑，只识别真正影响交付感的残余 AI 痕迹。',
    schema: HUMANIZER_REVIEW_SCHEMA,
  });

  const parsed = await parseStageJsonResponse({
    ai,
    model,
    stageLabel,
    rawText: raw,
    schema: HUMANIZER_REVIEW_SCHEMA,
    buildFallback: buildHumanizerFallbackReport,
    shouldStop,
  });

  let report = attachParseMeta(normalizeHumanizerReport(parsed.data), parsed.meta);
  if (shouldRecoverHumanizerIssues(parsed.data, report)) {
    const recoveredIssues = await recoverHumanizerIssues({
      ai,
      model,
      fileName,
      draft,
      report,
      shouldStop,
    });
    if (recoveredIssues.length > 0) {
      report = {
        ...normalizeHumanizerReport({
          ...report,
          issues: recoveredIssues,
        }),
        parseMeta: {
          ...report.parseMeta,
          parserStatus: report.parseMeta?.parserStatus
            ? `${report.parseMeta.parserStatus}+issue_recovery`
            : 'issue_recovery',
        },
      };
    }
  }

  return report;
};

const reviseHumanizerPass = async ({ ai, model, draft, report, assets, shouldStop }) => {
  const prompt = [
    '你现在执行中文商业文稿去AI修订。',
    '目标是只清理已识别问题，让文本更像成熟中文编辑写出的可交付文稿。',
    '当前诊断报告就是本轮全量问题清单，必须覆盖报告中的全部问题，不能只修前几项。',
    '这不是重写轮次，只允许做词、短句和局部句群级的最小必要修改。',
    '硬性要求：',
    '1. 保留原文事实、数字、专有名词、引语和核心判断。',
    '2. 不新增当前稿件之外的新事实、新案例和新论点。',
    '3. 不改成第一人称抒情、聊天腔、口播腔或鸡汤结尾。',
    '4. 能删套话就删套话，能把黑话改具体就不要扩写。',
    '5. 中文与英文、数字默认贴排；只删除残留的多余空格，不要补空格。',
    '固定规则：',
    assets.antiAiStyleRules,
    assets.commercialHumanizerRules,
    '去AI诊断：',
    formatHumanizerReportMarkdown(report, '去AI诊断'),
    buildLintSummary(draft),
    '当前文稿：',
    cleanText(draft),
    '只输出修订后的完整文稿。',
  ].join('\n\n');

  return applyDeterministicTextPolish(
    await buildTextPrompt({
      ai,
      model,
      prompt,
      shouldStop,
      systemInstruction: '你是中文商业文稿去AI修订编辑，只做最小必要修改并保持交付文体。',
    })
  );
};

const reviewAuditPass = async ({ ai, model, fileName, draft, assets, stageLabel, shouldStop }) => {
  const diagnosticDraft = getDiagnosticDraft(draft);
  const prompt = [
    `文档名：${fileName}`,
    '你现在做最终审计。',
    'final_audit_rubric.md：',
    assets.finalAuditRubric,
    '固定文风规则：',
    assets.antiAiStyleRules,
    assets.commercialHumanizerRules,
    '你的职责不是重写新稿，而是判断当前文本是否达到可交付状态。',
    '不要做事实核验，不要评价参考文献、URL、访问日期或未来时间节点。',
    '如果文末存在参考文献、链接列表或引用清单，只把它们视为附录，不作为交付阻塞问题的主要来源。',
    SPACING_POLICY_LINE,
    AUDIT_COLLECTION_RULE,
    `问题上限：${AUDIT_MAX_ISSUES} 个聚合问题。`,
    '返回 JSON 对象，字段必须为：summary, ready, verdict, unresolvedRisk, issues。',
    'ready 只能是 yes 或 no。verdict 只能是 pass 或 revise。若 ready 为 no，issues 不能为空。',
    buildLintSummary(diagnosticDraft),
    '正文：',
    diagnosticDraft,
  ].join('\n\n');

  const raw = await buildJsonPrompt({
    ai,
    model,
    prompt,
    shouldStop,
    systemInstruction: '你是中文商业文稿最终审计编辑，只保留真正阻塞交付的问题。',
    schema: AUDIT_REVIEW_SCHEMA,
  });

  const parsed = await parseStageJsonResponse({
    ai,
    model,
    stageLabel,
    rawText: raw,
    schema: AUDIT_REVIEW_SCHEMA,
    buildFallback: buildAuditFallbackReport,
    shouldStop,
  });

  let report = attachParseMeta(normalizeAuditReport(parsed.data), parsed.meta);
  if (shouldRecoverAuditIssues(parsed.data, report)) {
    const recoveredIssues = await recoverAuditIssues({
      ai,
      model,
      fileName,
      draft,
      report,
      shouldStop,
    });
    if (recoveredIssues.length > 0) {
      report = {
        ...normalizeAuditReport({
          ...report,
          issues: recoveredIssues,
        }),
        parseMeta: {
          ...report.parseMeta,
          parserStatus: report.parseMeta?.parserStatus
            ? `${report.parseMeta.parserStatus}+issue_recovery`
            : 'issue_recovery',
        },
      };
    }
  }

  return report;
};

const reviseAuditPass = async ({ ai, model, draft, report, assets, shouldStop }) => {
  const prompt = [
    '你现在执行最终审计回改。',
    '目标是只修复审计报告中明确点名的问题，不另写一篇新稿。',
    '当前审计报告就是本轮全量问题清单，必须覆盖报告中的全部问题，不能只修前几项。',
    '硬性要求：',
    '1. 保留原文结构、事实、数字、专有名词和核心判断。',
    '2. 不新增原文之外的新论点、新事实和新例子。',
    '3. 如果一个短语能解决问题，就不要整句重写。',
    '4. 只处理审计报告里明确指出的问题，不为追求精致过度改写。',
    '5. 中文与英文、数字默认贴排；只删除残留的多余空格，不要补空格。',
    '审计结论：',
    formatAuditReportMarkdown(report, '最终审计'),
    buildLintSummary(draft),
    '当前文稿：',
    cleanText(draft),
    '只输出修订后的完整文稿。',
  ].join('\n\n');

  return applyDeterministicTextPolish(
    await buildTextPrompt({
      ai,
      model,
      prompt,
      shouldStop,
      systemInstruction: '你是中文商业文稿审计修订编辑，只做最小必要修改。',
    })
  );
};

const runFinalPolish = async ({ ai, model, fileName, draft, auditReport, assets, shouldStop }) => {
  const prompt = [
    '你是发稿前最后一位 line editor，负责终修。',
    '这不是重写轮次，只允许在原文基础上做句级、短语级和极小幅度的段落收束。',
    '硬性要求：',
    '1. 保留文稿结构、事实、数字、专有名词和核心判断。',
    '2. 不新增原稿之外的新事实、新案例和新论点。',
    '3. 只清理残余 AI 腔、装饰性标点、残留的中英中数空格和不自然的收束。',
    '4. 这里只修正文，不负责最后的 Markdown 标记。',
    '5. 不要在这里新增 #、##、-、>、```、表格管道符等 Markdown 结构符号。',
    '6. 结尾只回到文中已经建立的判断，不补万能积极收束。',
    SPACING_POLICY_LINE,
    `文档名：${fileName}`,
    '固定规则：',
    assets.antiAiStyleRules,
    assets.commercialHumanizerRules,
    '最终审计：',
    formatAuditReportMarkdown(auditReport, '最终审计全量复检'),
    buildLintSummary(draft),
    '当前文稿：',
    cleanText(draft),
    '只输出修订后的完整正文，不要附加解释，不要输出 Markdown 装饰计划。',
  ].join('\n\n');

  return applyFinalPolishLocally(
    await buildTextPrompt({
      ai,
      model,
      prompt,
      shouldStop,
      systemInstruction: '你是中文商业文稿终稿 line editor，只修正文，不做最终 Markdown 装饰。',
    })
  );
};

const buildFinalMarkupPlanFallback = (text) => normalizeFinalMarkupPlan(buildLocalFinalMarkupPlan(text));

const createEmptyFinalMarkupPlan = () => ({
  summary: '',
  transforms: [],
});

const createEmptyFinalMarkupApplyMeta = () => ({
  appliedTransforms: [],
  rejectedTransforms: [],
});

const finalizeApprovedDraft = async ({ draft, buildMarkupPlan, onStatus, throwIfStopped }) => {
  const finalPolishedText = draft;

  throwIfStopped();
  onStatus?.('final.markup_plan', '正在生成最终 Markdown 标记计划...');
  const finalMarkupPlanJson = normalizeFinalMarkupPlan(await buildMarkupPlan(finalPolishedText));

  throwIfStopped();
  onStatus?.('final.markup_apply', '正在回填最终 Markdown 标记...');
  const applyResult = applyFinalMarkupPlan(finalPolishedText, finalMarkupPlanJson);

  return {
    finalPolishedText,
    finalMarkupPlanJson,
    finalMarkupApplyMeta: {
      appliedTransforms: applyResult.appliedTransforms,
      rejectedTransforms: applyResult.rejectedTransforms,
    },
    finalText: applyResult.finalText,
  };
};

const buildFinalMarkupPlan = async ({ ai, model, fileName, draft, auditReport, shouldStop }) => {
  const prompt = [
    '你现在不是正文编辑，而是终稿 Markdown 标记规划器。',
    '你的唯一任务是：判断哪些 block 适合补 Markdown 符号，以及补什么符号。',
    '硬性约束：',
    '1. 不改写正文，不删减正文，不补充正文，不改变字词顺序。',
    '2. 只允许增加 Markdown 语法字符、必要换行和围栏。',
    '3. 允许使用全部 Markdown 符号，只要合适；但如果某种写法需要新增正文词句、链接、说明、alt text、脚注解释或其他额外信息，就不要使用。',
    '4. 只返回需要变化的 block；未返回的 block 视为保持原样。',
    '5. 每个 transform 的 markdown 字段必须是该 block 应替换成的完整 Markdown 版本，而不是 diff。',
    '6. markdown 去掉 Markdown 语法和标点后，正文内容序列必须与原 block 完全一致。',
    '7. 如果原 block 不适合加工，就不要硬加符号。',
    `文档名：${fileName}`,
    '最终审计摘要：',
    cleanText(auditReport?.summary) || '无',
    '最终审计风险：',
    cleanText(auditReport?.unresolvedRisk) || '无',
    '以下是按空行切分后的终稿 block 清单：',
    buildMarkupPromptBlocks(draft),
    '返回 JSON 对象，字段必须为 summary, transforms。',
  ].join('\n\n');

  try {
    const raw = await buildJsonPrompt({
      ai,
      model,
      prompt,
      shouldStop,
      systemInstruction:
        '你是 Markdown 标记规划器。只规划符号，不改正文；允许使用全部 Markdown 语法，但不能新增正文信息。',
      schema: FINAL_MARKUP_PLAN_SCHEMA,
    });
    const parsed = tryParseJsonResponse(raw);
    if (parsed.ok) {
      return normalizeFinalMarkupPlan(parsed.value);
    }
  } catch {
    // fall through to local fallback
  }

  return buildFinalMarkupPlanFallback(draft);
};

export const __testOnly = {
  tryParseJsonResponse,
  buildTextPrompt,
  mergeContinuationText,
};

export const validateApiKey = async (apiKey, model = DEFAULT_MODEL) => {
  if (isMockApiKey(apiKey)) {
    return { ok: true, model: MOCK_MODEL };
  }
  const ai = createAiClient(apiKey);
  await withModelRequestControl({
    request: (abortSignal) =>
      ai.models.countTokens({
        model,
        contents: 'ping',
        config: buildModelRequestConfig({}, abortSignal),
      }),
  });
  return { ok: true, model };
};

export const runDeAiPipeline = async ({
  apiKey,
  model = DEFAULT_MODEL,
  fileName,
  originalText,
  parsedText,
  onStatus,
  onReviewState,
  shouldStop,
}) => {
  assertDocumentPresent(parsedText, '正文');

  const throwIfStopped = () => {
    if (shouldStop?.()) {
      throw createJobCanceledError();
    }
  };

  const buildLocalHumanizerReport = (draft) =>
    attachParseMeta(analyzeHumanizerLocally(getDiagnosticDraft(draft)), {
      parserStatus: 'local',
      parserError: '',
      rawPreview: previewText(draft),
    });

  const buildLocalAuditReport = (draft) =>
    attachParseMeta(analyzeAuditLocally(getDiagnosticDraft(draft)), {
      parserStatus: 'local',
      parserError: '',
      rawPreview: previewText(draft),
    });

  if (isMockApiKey(apiKey)) {
    const humanizerLoop = await runRefinementLoop({
      maxRounds: HUMANIZER_MAX_ROUNDS,
      initialText: parsedText,
      initialStageKey: 'humanizer.initial',
      initialStageLabel: '去AI全量初检',
      initialStatusMessage: () => '正在执行去AI全量初检...',
      reviseStageKey: 'humanizer.revise',
      reviseStatusMessage: (round) => `正在执行去AI全量修订（第 ${round} 轮）...`,
      recheckStageKey: 'humanizer.recheck',
      recheckStageLabel: '去AI全量复检',
      recheckStatusMessage: (round) => `正在执行去AI全量复检（第 ${round} 轮）...`,
      reviewDraft: async ({ draft }) => buildLocalHumanizerReport(draft),
      reviseDraft: async ({ draft }) => applyBasicHumanizerFixes(draft),
      isApproved: isHumanizerReady,
      onStatus,
      onReviewState,
      shouldStop,
    });

    const humanizerInitialReportJson = humanizerLoop.initialReport;
    const humanizerInitialReport = formatHumanizerReportMarkdown(humanizerInitialReportJson, '去AI全量初检');
    const humanizedText = humanizerLoop.finalText;
    const humanizerFinalReportJson = humanizerLoop.finalReport;
    const humanizerFinalReport = formatHumanizerReportMarkdown(
      humanizerFinalReportJson,
      buildRoundStageLabel('去AI全量复检', humanizerLoop.roundsUsed)
    );

    const auditLoop = await runRefinementLoop({
      maxRounds: AUDIT_MAX_ROUNDS,
      initialText: humanizedText,
      initialStageKey: 'audit.initial',
      initialStageLabel: '最终审计全量初检',
      initialStatusMessage: () => '正在执行最终审计全量初检...',
      reviseStageKey: 'audit.revise',
      reviseStatusMessage: (round) => `正在执行最终审计全量修订（第 ${round} 轮）...`,
      recheckStageKey: 'audit.recheck',
      recheckStageLabel: '最终审计全量复检',
      recheckStatusMessage: (round) => `正在执行最终审计全量复检（第 ${round} 轮）...`,
      reviewDraft: async ({ draft }) => buildLocalAuditReport(draft),
      reviseDraft: async ({ draft }) => applyAuditFixes(draft, fileName),
      isApproved: isAuditApproved,
      onStatus,
      onReviewState,
      shouldStop,
    });

    const auditInitialReportJson = auditLoop.initialReport;
    const auditInitialReport = formatAuditReportMarkdown(auditInitialReportJson, '最终审计全量初检');
    const auditedText = auditLoop.finalText;
    const auditFinalReportJson = auditLoop.finalReport;
    const auditFinalReport = formatAuditReportMarkdown(
      auditFinalReportJson,
      buildRoundStageLabel('最终审计全量复检', auditLoop.roundsUsed)
    );

    const auditApproved = isAuditApproved(auditFinalReportJson);
    let finalPolishedText = auditedText;
    let finalMarkupPlanJson = createEmptyFinalMarkupPlan();
    let finalMarkupApplyMeta = createEmptyFinalMarkupApplyMeta();
    let finalText = auditedText;
    if (auditApproved) {
      const approvedFinalization = await finalizeApprovedDraft({
        draft: auditedText,
        buildMarkupPlan: async (draft) => buildFinalMarkupPlanFallback(draft),
        onStatus,
        throwIfStopped,
      });
      finalPolishedText = approvedFinalization.finalPolishedText;
      finalMarkupPlanJson = approvedFinalization.finalMarkupPlanJson;
      finalMarkupApplyMeta = approvedFinalization.finalMarkupApplyMeta;
      finalText = approvedFinalization.finalText;
    } else {
      onStatus?.('final.skipped', '最终审计未通过，已跳过终修。');
    }

    return {
      originalText,
      parsedText,
      humanizerInitialReport,
      humanizerInitialReportJson,
      humanizedText,
      humanizerFinalReport,
      humanizerFinalReportJson,
      auditInitialReport,
      auditInitialReportJson,
      auditedText,
      auditFinalReport,
      auditFinalReportJson,
      finalPolishedText,
      finalMarkupPlanJson,
      finalMarkupApplyMeta,
      finalText,
      workflowMeta: {
        humanizerRoundsUsed: humanizerLoop.roundsUsed,
        auditRoundsUsed: auditLoop.roundsUsed,
        finalSkipped: !auditApproved,
        finalPolishBypassed: auditApproved,
        finalMarkupTransformsPlanned: finalMarkupPlanJson.transforms?.length || 0,
        finalMarkupTransformsApplied: finalMarkupApplyMeta.appliedTransforms.length,
        finalMarkupTransformsRejected: finalMarkupApplyMeta.rejectedTransforms.length,
      },
    };
  }

  const ai = createAiClient(apiKey);
  const assets = await loadRuntimeAssets();

  const humanizerLoop = await runRefinementLoop({
    maxRounds: HUMANIZER_MAX_ROUNDS,
    initialText: parsedText,
    initialStageKey: 'humanizer.initial',
    initialStageLabel: '去AI全量初检',
    initialStatusMessage: () => '正在执行去AI全量初检...',
    reviseStageKey: 'humanizer.revise',
    reviseStatusMessage: (round) => `正在执行去AI全量修订（第 ${round} 轮）...`,
    recheckStageKey: 'humanizer.recheck',
    recheckStageLabel: '去AI全量复检',
    recheckStatusMessage: (round) => `正在执行去AI全量复检（第 ${round} 轮）...`,
    reviewDraft: async ({ draft, stageLabel }) =>
      await reviewHumanizerPass({
        ai,
        model,
        fileName,
        draft,
        assets,
        stageLabel,
        shouldStop,
      }),
    reviseDraft: async ({ draft, report }) =>
      await reviseHumanizerPass({
        ai,
        model,
        draft,
        report,
        assets,
        shouldStop,
      }),
    isApproved: isHumanizerReady,
    onStatus,
    onReviewState,
    shouldStop,
  });

  const humanizerInitialReportJson = humanizerLoop.initialReport;
  const humanizerInitialReport = formatHumanizerReportMarkdown(humanizerInitialReportJson, '去AI全量初检');
  const humanizedText = humanizerLoop.finalText;
  const humanizerFinalReportJson = humanizerLoop.finalReport;
  const humanizerFinalReport = formatHumanizerReportMarkdown(
    humanizerFinalReportJson,
    buildRoundStageLabel('去AI全量复检', humanizerLoop.roundsUsed)
  );

  const auditLoop = await runRefinementLoop({
    maxRounds: AUDIT_MAX_ROUNDS,
    initialText: humanizedText,
    initialStageKey: 'audit.initial',
    initialStageLabel: '最终审计全量初检',
    initialStatusMessage: () => '正在执行最终审计全量初检...',
    reviseStageKey: 'audit.revise',
    reviseStatusMessage: (round) => `正在执行最终审计全量修订（第 ${round} 轮）...`,
    recheckStageKey: 'audit.recheck',
    recheckStageLabel: '最终审计全量复检',
    recheckStatusMessage: (round) => `正在执行最终审计全量复检（第 ${round} 轮）...`,
    reviewDraft: async ({ draft, stageLabel }) =>
      await reviewAuditPass({
        ai,
        model,
        fileName,
        draft,
        assets,
        stageLabel,
        shouldStop,
      }),
    reviseDraft: async ({ draft, report }) =>
      await reviseAuditPass({
        ai,
        model,
        draft,
        report,
        assets,
        shouldStop,
      }),
    isApproved: isAuditApproved,
    onStatus,
    onReviewState,
    shouldStop,
  });

  const auditInitialReportJson = auditLoop.initialReport;
  const auditInitialReport = formatAuditReportMarkdown(auditInitialReportJson, '最终审计全量初检');
  const auditedText = auditLoop.finalText;
  const auditFinalReportJson = auditLoop.finalReport;
  const auditFinalReport = formatAuditReportMarkdown(
    auditFinalReportJson,
    buildRoundStageLabel('最终审计全量复检', auditLoop.roundsUsed)
  );

  const auditApproved = isAuditApproved(auditFinalReportJson);
  let finalPolishedText = auditedText;
  let finalMarkupPlanJson = createEmptyFinalMarkupPlan();
  let finalMarkupApplyMeta = createEmptyFinalMarkupApplyMeta();
  let finalText = auditedText;
  if (auditApproved) {
    const approvedFinalization = await finalizeApprovedDraft({
      draft: auditedText,
      buildMarkupPlan: async (draft) =>
        await buildFinalMarkupPlan({
          ai,
          model,
          fileName,
          draft,
          auditReport: auditFinalReportJson,
          shouldStop,
        }),
      onStatus,
      throwIfStopped,
    });
    finalPolishedText = approvedFinalization.finalPolishedText;
    finalMarkupPlanJson = approvedFinalization.finalMarkupPlanJson;
    finalMarkupApplyMeta = approvedFinalization.finalMarkupApplyMeta;
    finalText = approvedFinalization.finalText;
  } else {
    onStatus?.('final.skipped', '最终审计未通过，已跳过终修。');
  }

  return {
    originalText,
    parsedText,
    humanizerInitialReport,
    humanizerInitialReportJson,
    humanizedText,
    humanizerFinalReport,
    humanizerFinalReportJson,
    auditInitialReport,
    auditInitialReportJson,
    auditedText,
    auditFinalReport,
    auditFinalReportJson,
    finalPolishedText,
    finalMarkupPlanJson,
    finalMarkupApplyMeta,
    finalText,
    workflowMeta: {
      humanizerRoundsUsed: humanizerLoop.roundsUsed,
      auditRoundsUsed: auditLoop.roundsUsed,
      finalSkipped: !auditApproved,
      finalPolishBypassed: auditApproved,
      finalMarkupTransformsPlanned: finalMarkupPlanJson.transforms?.length || 0,
      finalMarkupTransformsApplied: finalMarkupApplyMeta.appliedTransforms.length,
      finalMarkupTransformsRejected: finalMarkupApplyMeta.rejectedTransforms.length,
    },
  };
};
