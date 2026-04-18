import crypto from 'node:crypto';
import { createTaskOutputDir, writeTaskArtifacts } from './artifactStore.mjs';
import { parseUploadedDocument } from './docParser.mjs';
import { runDeAiPipeline, validateApiKey } from './deaiEngine.mjs';

const jobs = new Map();

const cleanText = (value = '') => String(value).trim();

const appendHistory = (job, type, message, node, details) => {
  job.history.push({
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    type,
    node: cleanText(node) || undefined,
    message: cleanText(message),
    details: cleanText(details) || undefined,
  });
  if (job.history.length > 100) {
    job.history.splice(0, job.history.length - 100);
  }
};

const touchJob = (job, patch = {}) => {
  Object.assign(job, patch, {
    updatedAt: new Date().toISOString(),
  });
};

const serializeJob = (job) => ({
  id: job.id,
  status: job.status,
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
  completedAt: job.completedAt,
  message: job.message,
  currentNode: job.currentNode,
  error: job.error,
  errorDetails: job.errorDetails,
  history: job.history,
  reviewState: job.reviewState,
  result: job.result,
});

const formatReviewIssues = (issues = []) =>
  issues
    .map((issue, index) =>
      [
        `${index + 1}. ${cleanText(issue.title) || '未命名问题'}${cleanText(issue.severity) ? ` [${cleanText(issue.severity)}]` : ''}`,
        cleanText(issue.category) ? `   类型：${cleanText(issue.category)}` : '',
        cleanText(issue.scope) ? `   范围：${cleanText(issue.scope)}` : '',
        cleanText(issue.diagnosis) ? `   判断：${cleanText(issue.diagnosis)}` : '',
        cleanText(issue.instruction) ? `   修订：${cleanText(issue.instruction)}` : '',
        cleanText(issue.excerpt) ? `   片段：${cleanText(issue.excerpt)}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    )
    .join('\n');

const formatReviewStateDetails = (reviewState) =>
  [
    reviewState.summary ? `摘要：${cleanText(reviewState.summary)}` : '',
    reviewState.ready ? `ready：${cleanText(reviewState.ready)}` : '',
    reviewState.verdict ? `verdict：${cleanText(reviewState.verdict)}` : '',
    reviewState.unresolvedRisk ? `风险：${cleanText(reviewState.unresolvedRisk)}` : '',
    reviewState.parserStatus ? `解析状态：${cleanText(reviewState.parserStatus)}` : '',
    reviewState.parserError ? `解析说明：${cleanText(reviewState.parserError)}` : '',
    Array.isArray(reviewState.issues) && reviewState.issues.length > 0
      ? `问题：\n${formatReviewIssues(reviewState.issues)}`
      : '问题：无',
  ]
    .filter(Boolean)
    .join('\n');

const requireFilePayload = (file) => {
  if (!file || typeof file !== 'object') {
    const error = new Error('缺少上传文件。');
    error.code = 'INVALID_REQUEST';
    throw error;
  }
  const name = cleanText(file.name);
  if (!name) {
    const error = new Error('上传文件名不能为空。');
    error.code = 'INVALID_REQUEST';
    throw error;
  }
  if (!cleanText(file.data)) {
    const error = new Error('上传文件内容为空。');
    error.code = 'INVALID_REQUEST';
    throw error;
  }
};

const processJob = async (job, file, apiKey) => {
  try {
    const throwIfStopped = () => {
      if (job.cancelRequested) {
        const error = new Error('任务已取消。');
        error.code = 'JOB_CANCELED';
        throw error;
      }
    };

    touchJob(job, {
      status: 'running',
      message: '正在解析文档...',
      currentNode: 'parse.document',
    });
    appendHistory(job, 'status', '开始解析文档。', 'parse.document');

    const parsed = await parseUploadedDocument(file);
    throwIfStopped();

    const taskDir = await createTaskOutputDir(job.id, file.name);
    appendHistory(job, 'status', '文档解析完成。', 'parse.complete');

    const pipeline = await runDeAiPipeline({
      apiKey,
      fileName: file.name,
      originalText: parsed.originalText,
      parsedText: parsed.parsedText,
      shouldStop: () => job.cancelRequested,
      onStatus: (node, message) => {
        throwIfStopped();
        touchJob(job, {
          status: 'running',
          currentNode: node,
          message,
        });
        appendHistory(job, 'status', message, node);
      },
      onReviewState: (reviewState) => {
        throwIfStopped();
        touchJob(job, {
          reviewState,
        });
        appendHistory(
          job,
          'status',
          `${cleanText(reviewState.stageLabel)}：${cleanText(reviewState.summary) || '审查完成。'}`,
          `${cleanText(reviewState.stageKey)}.report`,
          formatReviewStateDetails(reviewState)
        );
      },
    });
    throwIfStopped();

    const artifactResult = await writeTaskArtifacts({
      taskDir,
      fileName: file.name,
      parseMeta: parsed.parseMeta,
      pipeline,
    });

    touchJob(job, {
      status: 'succeeded',
      completedAt: new Date().toISOString(),
      currentNode: 'done',
      message: '去AI与最终审计已完成。',
      result: {
        taskId: job.id,
        fileName: file.name,
        parseMeta: parsed.parseMeta,
        originalText: pipeline.originalText,
        parsedText: pipeline.parsedText,
        humanizerInitialReport: pipeline.humanizerInitialReport,
        humanizedText: pipeline.humanizedText,
        humanizerFinalReport: pipeline.humanizerFinalReport,
        auditInitialReport: pipeline.auditInitialReport,
        auditedText: pipeline.auditedText,
        auditFinalReport: pipeline.auditFinalReport,
        finalPolishedText: pipeline.finalPolishedText,
        finalMarkupPlanJson: pipeline.finalMarkupPlanJson,
        finalMarkupApplyMeta: pipeline.finalMarkupApplyMeta,
        finalText: pipeline.finalText,
        outputDir: taskDir,
        artifactFiles: artifactResult.artifactFiles,
        finalPdfArtifact: artifactResult.finalPdfArtifact,
        pdfExport: artifactResult.pdfExport,
        humanizerInitialReportData: pipeline.humanizerInitialReportJson,
        humanizerFinalReportData: pipeline.humanizerFinalReportJson,
        auditInitialReportData: pipeline.auditInitialReportJson,
        auditFinalReportData: pipeline.auditFinalReportJson,
        workflowMeta: pipeline.workflowMeta,
      },
    });
    appendHistory(job, 'lifecycle', '任务执行完成。', 'done');
  } catch (error) {
    touchJob(job, {
      status: job.cancelRequested || error?.code === 'JOB_CANCELED' ? 'canceled' : 'failed',
      completedAt: new Date().toISOString(),
      error:
        job.cancelRequested || error?.code === 'JOB_CANCELED'
          ? undefined
          : error instanceof Error
            ? error.message
            : String(error || 'Unknown error'),
      errorDetails:
        job.cancelRequested || error?.code === 'JOB_CANCELED'
          ? undefined
          : cleanText(error?.details || error?.stack || ''),
      message: job.cancelRequested || error?.code === 'JOB_CANCELED' ? '任务已取消。' : '任务执行失败。',
    });
    appendHistory(
      job,
      job.status === 'canceled' ? 'lifecycle' : 'error',
      job.status === 'canceled' ? '任务已取消。' : job.error,
      job.currentNode || job.status,
      job.errorDetails
    );
  }
};

export const validateGeminiApiKey = async (apiKey) => await validateApiKey(apiKey);

export const createDeAiJob = async ({ file, context }) => {
  requireFilePayload(file);
  const apiKey = cleanText(context?.apiKey);
  if (!apiKey) {
    const error = new Error('缺少 Gemini API Key。');
    error.code = 'INVALID_REQUEST';
    throw error;
  }

  const job = {
    id: crypto.randomUUID(),
    status: 'queued',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: undefined,
    message: '任务已创建，等待处理。',
    currentNode: 'queued',
    error: undefined,
    history: [],
    cancelRequested: false,
    result: undefined,
  };

  appendHistory(job, 'lifecycle', '任务已创建。', 'queued');
  jobs.set(job.id, job);

  void processJob(job, file, apiKey);

  return serializeJob(job);
};

export const getDeAiJob = (jobId) => {
  const job = jobs.get(cleanText(jobId));
  if (!job) {
    const error = new Error('任务不存在。');
    error.code = 'JOB_NOT_FOUND';
    throw error;
  }
  return serializeJob(job);
};

export const cancelDeAiJob = (jobId) => {
  const job = jobs.get(cleanText(jobId));
  if (!job) {
    const error = new Error('任务不存在。');
    error.code = 'JOB_NOT_FOUND';
    throw error;
  }

  if (job.status === 'queued' || job.status === 'running') {
    job.cancelRequested = true;
    touchJob(job, {
      status: 'canceled',
      completedAt: new Date().toISOString(),
      message: '任务已取消。',
      currentNode: 'canceled',
    });
    appendHistory(job, 'lifecycle', '任务已取消。', 'canceled');
  }

  return serializeJob(job);
};
