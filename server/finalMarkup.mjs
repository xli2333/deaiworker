const cleanText = (value = '') =>
  String(value)
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '')
    .trim();

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

const stripMarkdownSyntax = (text) => {
  let result = String(text || '').replace(/\r\n/g, '\n');

  result = result.replace(/^(```|~~~)[^\n]*\n?/gm, '');
  result = result.replace(/^[`~]{3,}\s*$/gm, '');
  result = result.replace(/^\s{0,3}#{1,6}\s+/gm, '');
  result = result.replace(/^\s{0,3}>\s?/gm, '');
  result = result.replace(/^\s{0,3}(?:[-*+]\s+|\d+\.\s+|[-*+]\s+\[[ xX]\]\s+)/gm, '');
  result = result.replace(/^\s*(?:[-*_]\s*){3,}$/gm, '');
  result = result.replace(/^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*$/gm, '');
  result = result.replace(/^\|/gm, '').replace(/\|$/gm, '').replace(/\s*\|\s*/g, '');

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

const normalizeComparableText = (text) =>
  cleanText(stripMarkdownSyntax(text))
    .normalize('NFKC')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n+/g, '\n');

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

export const buildLocalFinalMarkupPlan = (text) => {
  const blocks = splitIntoMarkupBlocks(text);
  const transforms = [];

  for (const block of blocks) {
    const normalized = cleanText(block.text);
    if (!normalized) continue;

    let markdown = normalized;
    const lines = normalized.split('\n').map((line) => cleanText(line)).filter(Boolean);

    if (block.blockIndex === 0 && !/^#\s+/.test(normalized)) {
      markdown = `# ${normalized}`;
    } else if (/^[一二三四五六七八九十]+、/.test(normalized) && !/^#{1,6}\s+/.test(normalized)) {
      markdown = `## ${normalized}`;
    } else if (/^（[一二三四五六七八九十]+）/.test(normalized) && !/^#{1,6}\s+/.test(normalized)) {
      markdown = `### ${normalized}`;
    } else if (lines.length >= 2 && lines.every((line) => !/^[-*+]\s|^\d+\.\s|^>\s|^#\s/.test(line))) {
      const taskLike = lines.every((line) => /^[-*+]\s/.test(line) || /^（[一二三四五六七八九十]+）/.test(line));
      if (taskLike) {
        markdown = lines.map((line) => `- ${line.replace(/^[-*+]\s*/, '')}`).join('\n');
      }
    }

    if (markdown !== normalized) {
      transforms.push({
        blockIndex: block.blockIndex,
        markdown,
        reason: 'local_fallback_formatting',
      });
    }
  }

  return {
    summary: transforms.length > 0 ? `生成了 ${transforms.length} 个本地 Markdown 标记变换。` : '未生成额外 Markdown 标记变换。',
    transforms,
  };
};
