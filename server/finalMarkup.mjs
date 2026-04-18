const cleanText = (value = '') =>
  String(value)
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '')
    .trim();

const SHORT_TABLE_CELL_MAX_LENGTH = 24;
const TABLE_SEPARATOR_LINE_REGEX = /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*$/;
const TABLE_CELL_PREFIX_REGEX = /^(?:#{1,6}\s|>\s|[-*+]\s|\d+\.\s|\[[ xX]\]\s)/;
const SENTENCE_LIKE_PUNCTUATION_REGEX = /[。！？；：]/;
const NUMERIC_LIKE_CELL_REGEX =
  /^(?:[-+]?[$¥€£]?\d[\d,]*(?:\.\d+)?(?:%|倍|万|亿|元|人|个|天|月|年|次|项|家)?|(?:19|20)\d{2}(?:[-/]\d{1,2}(?:[-/]\d{1,2})?)?|Q[1-4]|H[12]|第?\d+(?:季度|年|月|天|次|项|家|人|个))$/iu;

export const splitIntoMarkupBlocks = (text) => {
  const normalized = cleanText(text);
  if (!normalized) return [];

  return normalized
    .split(/\n{2,}/)
    .map((block, blockIndex) => ({
      blockIndex,
      text: cleanText(block),
    }))
    .filter((block) => block.text);
};

const stripInlineMarkdownSyntax = (text) => {
  let result = String(text || '').replace(/\r\n/g, '\n');

  result = result.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1');
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
  result = result.replace(/\[([^\]]+)\]\[([^\]]*)\]/g, '$1');
  result = result.replace(/<((?:https?:\/\/|mailto:)[^>]+)>/g, '$1');
  result = result.replace(/\[\^([^\]]+)\]/g, '');
  result = result.replace(/^\[\^([^\]]+)\]:\s*/gm, '');
  result = result.replace(/\*\*(.*?)\*\*/g, '$1');
  result = result.replace(/__(.*?)__/g, '$1');
  result = result.replace(/~~(.*?)~~/g, '$1');
  result = result.replace(/==(.*?)==/g, '$1');
  result = result.replace(/`([^`]+)`/g, '$1');
  result = result.replace(/\*([^*\n]+)\*/g, '$1');
  result = result.replace(/_([^_\n]+)_/g, '$1');

  return result;
};

const splitStructuredLineTokens = (line) => {
  const normalized = cleanText(stripInlineMarkdownSyntax(line));
  if (!normalized) return [];

  if (normalized.includes('|')) {
    return normalized
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((token) => cleanText(token))
      .filter(Boolean);
  }

  if (/\t/.test(normalized)) {
    return normalized.split(/\t+/).map((token) => cleanText(token)).filter(Boolean);
  }

  if (/\S(?:.*\S)?\s{2,}\S/.test(normalized)) {
    return normalized.split(/\s{2,}/).map((token) => cleanText(token)).filter(Boolean);
  }

  return [normalized];
};

const normalizeComparableText = (text) => {
  const tokens = [];
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  let insideFence = false;

  for (const rawLine of lines) {
    let line = cleanText(rawLine);
    if (!line) continue;

    if (/^(```|~~~)/.test(line)) {
      insideFence = !insideFence;
      continue;
    }

    if (!insideFence) {
      if (TABLE_SEPARATOR_LINE_REGEX.test(line)) {
        continue;
      }

      line = line
        .replace(/^\s{0,3}#{1,6}\s+/, '')
        .replace(/^\s{0,3}>\s?/, '')
        .replace(/^\s{0,3}(?:[-*+]\s+|\d+\.\s+|[-*+]\s+\[[ xX]\]\s+)/, '');
    }

    tokens.push(
      ...splitStructuredLineTokens(line).map((token) =>
        cleanText(token)
          .normalize('NFKC')
          .replace(/[ \t]+/g, ' ')
      )
    );
  }

  return tokens.join('\n');
};

const normalizeTransform = (transform) => ({
  blockIndex: Number.isFinite(Number(transform?.blockIndex)) ? Number(transform.blockIndex) : -1,
  markdown: cleanText(transform?.markdown),
  reason: cleanText(transform?.reason),
});

export const normalizeFinalMarkupPlan = (plan = {}) => {
  const seen = new Set();
  const transforms = (Array.isArray(plan?.transforms) ? plan.transforms : [])
    .map(normalizeTransform)
    .filter((transform) => transform.blockIndex >= 0 && transform.markdown)
    .filter((transform) => {
      if (seen.has(transform.blockIndex)) return false;
      seen.add(transform.blockIndex);
      return true;
    })
    .sort((left, right) => left.blockIndex - right.blockIndex);

  return {
    summary: cleanText(plan?.summary),
    transforms,
  };
};

export const buildMarkupPromptBlocks = (text) =>
  splitIntoMarkupBlocks(text)
    .map((block) => [`[BLOCK ${block.blockIndex}]`, block.text, `[END BLOCK ${block.blockIndex}]`].join('\n'))
    .join('\n\n');

export const applyFinalMarkupPlan = (text, plan) => {
  const blocks = splitIntoMarkupBlocks(text);
  const normalizedPlan = normalizeFinalMarkupPlan(plan);
  const nextBlocks = blocks.map((block) => block.text);
  const appliedTransforms = [];
  const rejectedTransforms = [];

  for (const transform of normalizedPlan.transforms) {
    const sourceBlock = blocks[transform.blockIndex];
    if (!sourceBlock) {
      rejectedTransforms.push({
        ...transform,
        error: 'block_not_found',
      });
      continue;
    }

    const sourceComparable = normalizeComparableText(sourceBlock.text);
    const targetComparable = normalizeComparableText(transform.markdown);

    if (!targetComparable || sourceComparable !== targetComparable) {
      rejectedTransforms.push({
        ...transform,
        error: 'content_mismatch',
      });
      continue;
    }

    nextBlocks[transform.blockIndex] = transform.markdown;
    appliedTransforms.push(transform);
  }

  return {
    finalText: nextBlocks.join('\n\n').trim(),
    summary: normalizedPlan.summary,
    transforms: normalizedPlan.transforms,
    appliedTransforms,
    rejectedTransforms,
  };
};

const looksShortTableCell = (cell) => {
  const normalized = cleanText(cell);
  if (!normalized || normalized.length > SHORT_TABLE_CELL_MAX_LENGTH) return false;
  if (TABLE_CELL_PREFIX_REGEX.test(normalized)) return false;
  if ((normalized.match(SENTENCE_LIKE_PUNCTUATION_REGEX) || []).length >= 2) return false;
  if (/[。！？]$/.test(normalized) && normalized.length > 10) return false;
  return true;
};

const looksNumericLikeCell = (cell) => NUMERIC_LIKE_CELL_REGEX.test(cleanText(cell).replace(/[，]/g, ','));

const escapeTableCell = (cell) => cleanText(cell).replace(/\|/g, '\\|');

const chunkArray = (items, size) => {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const renderMarkdownTable = (rows) => {
  if (rows.length < 2 || rows[0].length < 2) return '';

  const header = `| ${rows[0].map(escapeTableCell).join(' | ')} |`;
  const separator = `| ${rows[0].map(() => '---').join(' | ')} |`;
  const body = rows.slice(1).map((row) => `| ${row.map(escapeTableCell).join(' | ')} |`);
  return [header, separator, ...body].join('\n');
};

const splitStructuredRowCells = (line) => {
  const normalized = cleanText(line);
  if (!normalized || normalized.includes('|')) return [];
  if (/\t/.test(normalized)) {
    return normalized.split(/\t+/).map((cell) => cleanText(cell)).filter(Boolean);
  }
  if (/\S(?:.*\S)?\s{2,}\S/.test(normalized)) {
    return normalized.split(/\s{2,}/).map((cell) => cleanText(cell)).filter(Boolean);
  }
  return [];
};

const buildMarkdownTableFromStructuredLines = (lines) => {
  const rows = lines.map(splitStructuredRowCells);
  if (rows.length < 2) return '';
  if (rows.some((row) => row.length < 2)) return '';

  const columnCount = rows[0].length;
  if (rows.some((row) => row.length !== columnCount)) return '';
  if (!rows.flat().every(looksShortTableCell)) return '';
  if (rows.flat().filter(looksNumericLikeCell).length < Math.max(2, columnCount - 1)) return '';
  if (rows[0].every(looksNumericLikeCell)) return '';

  return renderMarkdownTable(rows);
};

const scoreFlatTableRows = (rows) => {
  if (rows.length < 3) return -1;
  if (!rows.flat().every(looksShortTableCell)) return -1;
  if (rows[0].every(looksNumericLikeCell)) return -1;

  const bodyRows = rows.slice(1);
  const numericBodyCount = bodyRows.flat().filter(looksNumericLikeCell).length;
  if (numericBodyCount < Math.max(2, rows[0].length - 1)) return -1;

  let strongNumericColumns = 0;
  for (let columnIndex = 0; columnIndex < rows[0].length; columnIndex += 1) {
    const columnCells = bodyRows.map((row) => row[columnIndex]);
    const numericRatio = columnCells.filter(looksNumericLikeCell).length / columnCells.length;
    if (numericRatio >= 0.6) {
      strongNumericColumns += 1;
    }
  }

  if (strongNumericColumns === 0) return -1;
  return rows.length * 3 + strongNumericColumns * 5 + numericBodyCount;
};

const buildMarkdownTableFromFlatLines = (lines) => {
  const cells = lines.map((line) => cleanText(line)).filter(Boolean);
  if (cells.length < 6) return '';

  const maxColumns = Math.min(5, Math.floor(cells.length / 3));
  let bestCandidate = null;

  for (let columnCount = 2; columnCount <= maxColumns; columnCount += 1) {
    if (cells.length % columnCount !== 0) continue;

    const rows = chunkArray(cells, columnCount);
    const score = scoreFlatTableRows(rows);
    if (score < 0) continue;

    if (!bestCandidate || score > bestCandidate.score || (score === bestCandidate.score && columnCount > bestCandidate.columnCount)) {
      bestCandidate = {
        columnCount,
        rows,
        score,
      };
    }
  }

  return bestCandidate ? renderMarkdownTable(bestCandidate.rows) : '';
};

const buildMarkdownTableIfPossible = (lines) =>
  buildMarkdownTableFromStructuredLines(lines) || buildMarkdownTableFromFlatLines(lines);

export const buildLocalFinalMarkupPlan = (text) => {
  const blocks = splitIntoMarkupBlocks(text);
  const transforms = [];

  for (const block of blocks) {
    const normalized = cleanText(block.text);
    if (!normalized) continue;

    let markdown = normalized;
    let reason = 'local_fallback_formatting';
    const lines = normalized.split('\n').map((line) => cleanText(line)).filter(Boolean);

    const tableMarkdown = buildMarkdownTableIfPossible(lines);
    if (tableMarkdown) {
      markdown = tableMarkdown;
      reason = 'local_fallback_table_reconstruction';
    } else if (block.blockIndex === 0 && lines.length === 1 && !/^#\s+/.test(normalized)) {
      markdown = `# ${normalized}`;
    } else if (/^[一二三四五六七八九十]+、/.test(normalized) && !/^#{1,6}\s+/.test(normalized)) {
      markdown = `## ${normalized}`;
    } else if (/^（[一二三四五六七八九十]+）/.test(normalized) && !/^#{1,6}\s+/.test(normalized)) {
      markdown = `### ${normalized}`;
    }

    if (markdown !== normalized) {
      transforms.push({
        blockIndex: block.blockIndex,
        markdown,
        reason,
      });
    }
  }

  return {
    summary: transforms.length > 0 ? `生成了 ${transforms.length} 个本地 Markdown 标记变换。` : '未生成额外 Markdown 标记变换。',
    transforms,
  };
};
