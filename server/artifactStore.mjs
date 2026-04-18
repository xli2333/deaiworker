import fs from 'node:fs/promises';
import path from 'node:path';
import { exportMarkdownToPdf } from './pdfExporter.mjs';

const ROOT_DIR = process.cwd();
const OUTPUT_ROOT = process.env.DEAI_OUTPUT_ROOT
  ? path.resolve(process.env.DEAI_OUTPUT_ROOT)
  : path.join(ROOT_DIR, 'outputs', 'tasks');

const normalize = (text = '') => String(text).replace(/\r\n/g, '\n').trim();

const sanitizeFileStem = (value) =>
  String(value || 'document')
    .trim()
    .replace(/\.[^.]+$/, '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80) || 'document';

export const createTaskOutputDir = async (taskId, fileName) => {
  const dir = path.join(OUTPUT_ROOT, `${taskId}_${sanitizeFileStem(fileName)}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
};

const writeTextFile = async (filePath, content) => {
  await fs.writeFile(filePath, `${normalize(content)}\n`, 'utf8');
};

const writeJsonFile = async (filePath, payload) => {
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
};

export const writeTaskArtifacts = async ({ taskDir, fileName, parseMeta, pipeline }) => {
  const artifactFiles = [];
  let finalPdfArtifact;
  let pdfExport = null;

  const writeTextArtifact = async (fileNameValue, content) => {
    const filePath = path.join(taskDir, fileNameValue);
    await writeTextFile(filePath, content);
    artifactFiles.push(fileNameValue);
  };

  const writeJsonArtifact = async (fileNameValue, payload) => {
    const filePath = path.join(taskDir, fileNameValue);
    await writeJsonFile(filePath, payload);
    artifactFiles.push(fileNameValue);
  };

  await writeJsonArtifact('source_meta.json', { fileName, parseMeta });
  await writeTextArtifact('01_original_text.md', pipeline.originalText);
  await writeTextArtifact('02_parsed_text.md', pipeline.parsedText);
  await writeJsonArtifact('03_humanizer_initial_report.json', pipeline.humanizerInitialReportJson);
  await writeTextArtifact('03_humanizer_initial_report.md', pipeline.humanizerInitialReport);
  await writeTextArtifact('04_humanized_text.md', pipeline.humanizedText);
  await writeJsonArtifact('05_humanizer_final_report.json', pipeline.humanizerFinalReportJson);
  await writeTextArtifact('05_humanizer_final_report.md', pipeline.humanizerFinalReport);
  await writeJsonArtifact('06_audit_initial_report.json', pipeline.auditInitialReportJson);
  await writeTextArtifact('06_audit_initial_report.md', pipeline.auditInitialReport);
  await writeTextArtifact('07_audited_text.md', pipeline.auditedText);
  await writeJsonArtifact('08_audit_final_report.json', pipeline.auditFinalReportJson);
  await writeTextArtifact('08_audit_final_report.md', pipeline.auditFinalReport);
  await writeTextArtifact('09_final_polished_text.md', pipeline.finalPolishedText || pipeline.finalText);
  await writeJsonArtifact('10_final_markup_plan.json', {
    ...(pipeline.finalMarkupPlanJson || {}),
    applyMeta: pipeline.finalMarkupApplyMeta || undefined,
  });
  await writeTextArtifact('11_final_text.md', pipeline.finalText);
  pdfExport = await exportMarkdownToPdf({
    markdownPath: path.join(taskDir, '11_final_text.md'),
    pdfPath: path.join(taskDir, '12_final_text.pdf'),
  });
  if (pdfExport.ok) {
    finalPdfArtifact = '12_final_text.pdf';
    artifactFiles.push(finalPdfArtifact);
  }
  await writeJsonArtifact('task_manifest.json', {
    fileName,
    parseMeta,
    artifactFiles,
    workflowMeta: pipeline.workflowMeta || undefined,
    finalPdfArtifact: finalPdfArtifact || null,
    pdfExport,
  });

  return {
    artifactFiles,
    finalPdfArtifact,
    pdfExport,
  };
};
