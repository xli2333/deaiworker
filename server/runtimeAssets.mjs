import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT_DIR = process.cwd();
const RUNTIME_DIR = path.join(ROOT_DIR, 'rag_assets', 'runtime');

const assetMap = {
  antiAiStyleRules: 'anti_ai_style_rules.md',
  commercialHumanizerRules: 'commercial_humanizer_rules.md',
  commercialHumanizerPatterns: 'commercial_humanizer_patterns.md',
  commercialHumanizerQuickChecks: 'commercial_humanizer_quick_checks.md',
  humanizerReference: 'humanizer_zh_reference.md',
  finalAuditRubric: 'final_audit_rubric.md',
};

let cachedAssets = null;

const normalize = (text) => String(text || '').replace(/\r\n/g, '\n').trim();

export const loadRuntimeAssets = async () => {
  if (cachedAssets) {
    return cachedAssets;
  }

  const entries = await Promise.all(
    Object.entries(assetMap).map(async ([key, fileName]) => {
      const value = normalize(await fs.readFile(path.join(RUNTIME_DIR, fileName), 'utf8'));
      return [key, value];
    })
  );

  cachedAssets = Object.fromEntries(entries);
  return cachedAssets;
};
