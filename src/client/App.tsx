import React, { useMemo, useRef, useState } from 'react';
import {
  DocumentTextIcon,
  PaperClipIcon,
  ShieldCheckIcon,
  XMarkIcon,
} from '@heroicons/react/24/solid';
import ApiKeyInput from './components/ApiKeyInput';
import ResultViewer from './components/ResultViewer';
import {
  buildApiUrl,
  cancelDeAiJob,
  clearStoredApiKey,
  createDeAiJob,
  getStoredApiKey,
  setStoredApiKey,
  validateApiKey,
  waitForJob,
} from './services/api';
import type { DeAiJob, UploadedFilePayload } from './types';

const NODE_LABEL_MAP: Record<string, string> = {
  queued: '排队中',
  'parse.document': '解析原文',
  'parse.complete': '解析完成',
  'humanizer.initial': '去AI全量初检',
  'humanizer.revise': '去AI全量修订',
  'humanizer.recheck': '去AI全量复检',
  'audit.initial': '最终审计全量初检',
  'audit.revise': '最终审计全量修订',
  'audit.recheck': '最终审计全量复检',
  'final.polish': '终修',
  'final.markup_plan': '终稿标记规划',
  'final.markup_apply': '终稿标记回填',
  'final.skipped': '终修跳过',
  done: '已完成',
  canceled: '已取消',
};

const PARSER_STATUS_LABEL_MAP: Record<string, string> = {
  local: '本地规则生成',
  direct: '直接解析 JSON',
  extracted: '提取 JSON 片段后解析',
  heuristic: '本地启发式修复后解析',
  repaired: '修复 JSON 后解析',
  fallback: '回退为保守报告',
};

const getNodeLabel = (node?: string) => {
  if (!node) return '等待进入处理阶段。';
  return NODE_LABEL_MAP[node] || node;
};

const getSeverityTone = (severity?: string) => {
  const normalized = String(severity || '').toLowerCase();
  if (normalized === 'high' || normalized === 'critical') {
    return 'border-rose-200 bg-rose-50 text-rose-700';
  }
  if (normalized === 'low') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  }
  return 'border-amber-200 bg-amber-50 text-amber-700';
};

const readFileAsBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.split(',')[1] || '');
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const readFileAsText = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = reject;
    reader.readAsText(file);
  });

const inferMimeType = (file: File) => {
  if (file.type) return file.type;
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith('.md')) return 'text/markdown';
  if (lowerName.endsWith('.txt')) return 'text/plain';
  if (lowerName.endsWith('.docx')) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if (lowerName.endsWith('.pdf')) return 'application/pdf';
  return 'application/octet-stream';
};

const isBinaryFile = (file: File) => {
  const lowerName = file.name.toLowerCase();
  return lowerName.endsWith('.pdf') || lowerName.endsWith('.docx');
};

const buildUploadedPayload = async (file: File): Promise<UploadedFilePayload> => {
  const mimeType = inferMimeType(file);
  const binary = isBinaryFile(file);
  return {
    name: file.name,
    mimeType,
    isText: !binary,
    data: binary ? await readFileAsBase64(file) : await readFileAsText(file),
  };
};

const App: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [apiKey, setApiKey] = useState(() => getStoredApiKey());
  const [isValidatingKey, setIsValidatingKey] = useState(false);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadedPayload, setUploadedPayload] = useState<UploadedFilePayload | null>(null);
  const [isPreparingFile, setIsPreparingFile] = useState(false);
  const [job, setJob] = useState<DeAiJob | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canSubmit = Boolean(apiKey.trim() && uploadedPayload && !isPreparingFile && !isSubmitting);

  const statusTone = useMemo(() => {
    if (!job) return 'bg-slate-100 text-slate-600';
    if (job.status === 'succeeded') return 'bg-emerald-100 text-emerald-700';
    if (job.status === 'failed') return 'bg-rose-100 text-rose-700';
    if (job.status === 'canceled') return 'bg-amber-100 text-amber-700';
    return 'bg-sky-100 text-sky-700';
  }, [job]);

  const currentStepLabel = useMemo(() => getNodeLabel(job?.currentNode), [job?.currentNode]);

  const handleValidateKey = async () => {
    const normalized = apiKey.trim();
    if (!normalized) {
      setValidationMessage('请先输入 Gemini API Key。');
      return;
    }

    setIsValidatingKey(true);
    try {
      const response = await validateApiKey(normalized);
      setStoredApiKey(normalized);
      setValidationMessage(`Key 校验通过，当前默认模型：${response.model}`);
    } catch (error) {
      setValidationMessage(error instanceof Error ? error.message : 'Key 校验失败。');
    } finally {
      setIsValidatingKey(false);
    }
  };

  const handleClearKey = () => {
    clearStoredApiKey();
    setApiKey('');
    setValidationMessage('已清空当前会话中的 Gemini API Key。');
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsPreparingFile(true);
    try {
      const payload = await buildUploadedPayload(file);
      setSelectedFile(file);
      setUploadedPayload(payload);
    } catch (error) {
      setValidationMessage(error instanceof Error ? `读取文件失败：${error.message}` : '读取文件失败。');
      setSelectedFile(null);
      setUploadedPayload(null);
    } finally {
      setIsPreparingFile(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleRemoveFile = () => {
    setSelectedFile(null);
    setUploadedPayload(null);
  };

  const handleSubmit = async () => {
    if (!uploadedPayload || !apiKey.trim()) return;

    setIsSubmitting(true);
    setValidationMessage(null);
    setJob(null);

    try {
      const { job: createdJob } = await createDeAiJob(apiKey.trim(), uploadedPayload);
      setJob(createdJob);
      setStoredApiKey(apiKey.trim());
      await waitForJob(createdJob.id, setJob);
    } catch (error) {
      setValidationMessage(error instanceof Error ? error.message : '任务创建失败。');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = async () => {
    if (!job || (job.status !== 'queued' && job.status !== 'running')) return;
    try {
      const { job: canceledJob } = await cancelDeAiJob(job.id);
      setJob(canceledJob);
    } catch (error) {
      setValidationMessage(error instanceof Error ? error.message : '取消任务失败。');
    }
  };

  const handleDownloadFinal = () => {
    const finalText = job?.result?.finalText;
    if (!finalText) return;
    const blob = new Blob([finalText], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${(job.result.fileName || 'de_ai_result').replace(/\.[^.]+$/, '')}_final.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadFinalPdf = () => {
    const pdfArtifact = job?.result?.finalPdfArtifact;
    if (!job?.id || !pdfArtifact) return;
    const anchor = document.createElement('a');
    anchor.href = buildApiUrl(
      `/api/deai/jobs/${encodeURIComponent(job.id)}/artifacts/${encodeURIComponent(pdfArtifact)}`
    );
    anchor.download = pdfArtifact;
    anchor.click();
  };

  const handleDownloadBundle = () => {
    if (!job?.result) return;
    const payload = {
      job: {
        id: job.id,
        status: job.status,
        createdAt: job.createdAt,
        completedAt: job.completedAt,
        history: job.history || [],
      },
      result: job.result,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${(job.result.fileName || 'de_ai_result').replace(/\.[^.]+$/, '')}_bundle.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen px-4 py-8 md:px-6 md:py-12">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <div className="rounded-[32px] bg-white px-6 py-8 shadow-[0_25px_80px_rgba(15,23,42,0.08)] ring-1 ring-slate-100">
          <div className="max-w-3xl">
            <h1 className="font-serif text-4xl font-bold tracking-tight text-slate-900 md:text-5xl">
              上传一个文档，
              <br />
              <span className="bg-gradient-to-r from-report-accent to-teal-500 bg-clip-text text-transparent">
                做强化去AI与最终审计
              </span>
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-500 md:text-base">
              当前版本只做单文档链路：解析原文、去AI全量初检、去AI全量修订、去AI全量复检、最终审计、终修与结果导出。
            </p>
          </div>
        </div>

        <ApiKeyInput
          value={apiKey}
          isValidating={isValidatingKey}
          validationMessage={validationMessage}
          onChange={setApiKey}
          onValidate={handleValidateKey}
          onClear={handleClearKey}
        />

        <div className="rounded-[32px] bg-white shadow-[0_25px_80px_rgba(15,23,42,0.06)] ring-1 ring-slate-100">
          <div className="px-6 py-6">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-700">
              <DocumentTextIcon className="h-5 w-5 text-report-accent" />
              单文档输入
            </div>
            <p className="mt-2 text-sm leading-7 text-slate-500">支持 `PDF / DOCX / TXT / MD`。当前任务只接收一个文件。</p>

            {selectedFile ? (
              <div className="mt-5 flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold text-slate-800">{selectedFile.name}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {uploadedPayload?.mimeType} · {(selectedFile.size / 1024).toFixed(1)} KB
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleRemoveFile}
                  className="rounded-lg p-2 text-slate-400 transition hover:bg-white hover:text-rose-500"
                >
                  <XMarkIcon className="h-5 w-5" />
                </button>
              </div>
            ) : null}
          </div>

          <div className="flex items-center justify-between rounded-b-[32px] border-t border-slate-100 bg-slate-50/70 px-6 py-4">
            <div className="flex items-center gap-3">
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx,.txt,.md"
                className="hidden"
                onChange={handleFileChange}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-slate-500 transition hover:bg-white hover:text-report-accent"
              >
                <PaperClipIcon className="h-4 w-4" />
                {isPreparingFile ? '正在读取文件...' : '上传文档'}
              </button>
              <div className="text-xs text-slate-400">只保留单文档去AI链路，不走研究/配图/发布流程</div>
            </div>

            <button
              type="button"
              disabled={!canSubmit}
              onClick={() => void handleSubmit()}
              className="rounded-xl bg-report-accent px-5 py-3 text-sm font-bold text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? '正在创建任务...' : '开始去AI'}
            </button>
          </div>
        </div>

        {job ? (
          <div className="rounded-[32px] bg-white px-6 py-6 shadow-[0_25px_80px_rgba(15,23,42,0.06)] ring-1 ring-slate-100">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="flex items-center gap-3">
                  <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusTone}`}>
                    {job.status === 'queued'
                      ? '排队中'
                      : job.status === 'running'
                        ? '运行中'
                        : job.status === 'succeeded'
                          ? '已完成'
                          : job.status === 'canceled'
                            ? '已取消'
                            : '失败'}
                  </span>
                  <div className="text-xs font-medium text-slate-400">任务 ID：{job.id}</div>
                </div>
                <div className="mt-3 text-sm font-bold text-slate-800">{job.message || '任务已创建。'}</div>
                <div className="mt-1 text-xs text-slate-500">
                  当前步骤：{currentStepLabel}
                  {job.currentNode ? ` · ${job.currentNode}` : ''}
                </div>
                {job.error ? <div className="mt-3 text-sm text-rose-600">{job.error}</div> : null}
              </div>

              {(job.status === 'queued' || job.status === 'running') && (
                <button
                  type="button"
                  onClick={() => void handleCancel()}
                  className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
                >
                  中止任务
                </button>
              )}
            </div>

            <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,0.88fr)_minmax(0,1.12fr)]">
              <div className="rounded-3xl border border-slate-200 bg-slate-50 px-5 py-5">
                <div className="text-sm font-bold text-slate-800">当前执行状态</div>
                <div className="mt-3 text-xl font-bold text-slate-900">{currentStepLabel}</div>
                <div className="mt-1 text-xs text-slate-500">{job.currentNode || '等待进入处理阶段。'}</div>

                {job.reviewState ? (
                  <div className="mt-5 rounded-2xl border border-slate-200 bg-white px-4 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-bold text-slate-800">最近一次全量审查：{job.reviewState.stageLabel}</div>
                      {job.reviewState.parserStatus ? (
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                          {PARSER_STATUS_LABEL_MAP[job.reviewState.parserStatus] || job.reviewState.parserStatus}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-3 text-sm leading-7 text-slate-700">
                      {job.reviewState.summary || '当前阶段暂未返回摘要。'}
                    </div>
                    <div className="mt-2 text-xs leading-6 text-slate-500">
                      当前模式：先穷举全文问题，再一次性修订，不再按 8 条一批返回。
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
                      {job.reviewState.ready ? (
                        <span className="rounded-full bg-slate-100 px-3 py-1">ready：{job.reviewState.ready}</span>
                      ) : null}
                      {job.reviewState.verdict ? (
                        <span className="rounded-full bg-slate-100 px-3 py-1">verdict：{job.reviewState.verdict}</span>
                      ) : null}
                    </div>
                    {job.reviewState.unresolvedRisk ? (
                      <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-7 text-amber-800">
                        风险：{job.reviewState.unresolvedRisk}
                      </div>
                    ) : null}
                    {job.reviewState.parserError ? (
                      <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-7 text-rose-700">
                        解析说明：{job.reviewState.parserError}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="mt-5 rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-4 text-sm text-slate-500">
                    当前还没有生成审查结论。
                  </div>
                )}

                {job.errorDetails ? (
                  <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4">
                    <div className="text-sm font-bold text-rose-700">错误细节</div>
                    <pre className="pretty-scrollbar mt-3 max-h-52 overflow-auto whitespace-pre-wrap break-words text-xs leading-6 text-rose-800">
                      {job.errorDetails}
                    </pre>
                  </div>
                ) : null}
              </div>

              <div className="rounded-3xl border border-slate-200 bg-slate-50 px-5 py-5">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-bold text-slate-800">最近一次全量问题清单</div>
                  <div className="rounded-full bg-slate-200 px-3 py-1 text-xs font-medium text-slate-600">
                    {job.reviewState?.issues?.length || 0} 项
                  </div>
                </div>
                <div className="mt-2 text-xs leading-6 text-slate-500">
                  同类问题允许合并展示，但当前列表不再是分批抽样。
                </div>
                {job.reviewState?.issues?.length ? (
                  <div className="mt-4 space-y-3">
                    {job.reviewState.issues.map((issue, index) => (
                      <div key={`${issue.title}-${index}`} className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-sm font-bold text-slate-900">
                            {index + 1}. {issue.title || '未命名问题'}
                          </div>
                          <span className={`rounded-full border px-3 py-1 text-xs font-medium ${getSeverityTone(issue.severity)}`}>
                            {issue.severity || 'medium'}
                          </span>
                          {issue.category ? (
                            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">
                              类型：{issue.category}
                            </span>
                          ) : null}
                          {issue.scope ? (
                            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">
                              范围：{issue.scope}
                            </span>
                          ) : null}
                        </div>
                        {issue.diagnosis ? (
                          <div className="mt-3 text-sm leading-7 text-slate-700">判断：{issue.diagnosis}</div>
                        ) : null}
                        {issue.instruction ? (
                          <div className="mt-2 text-sm leading-7 text-slate-700">修订：{issue.instruction}</div>
                        ) : null}
                        {issue.excerpt ? (
                          <pre className="pretty-scrollbar mt-3 max-h-32 overflow-auto rounded-2xl bg-slate-950 px-4 py-3 whitespace-pre-wrap break-words text-xs leading-6 text-slate-100">
                            {issue.excerpt}
                          </pre>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-4 text-sm text-slate-500">
                    当前阶段没有返回具体问题，或该轮审查已判定为可继续流转。
                  </div>
                )}
              </div>
            </div>

            {job.history?.length ? (
              <div className="mt-5 rounded-3xl bg-slate-50 px-5 py-5">
                <div className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-700">
                  <ShieldCheckIcon className="h-4 w-4 text-report-accent" />
                  任务日志
                </div>
                <div className="pretty-scrollbar max-h-64 space-y-3 overflow-auto">
                  {job.history.map((entry) => (
                    <div key={entry.id} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                      <div className="text-xs text-slate-400">{new Date(entry.at).toLocaleString('zh-CN')}</div>
                      <div className="mt-1 text-sm font-medium text-slate-800">{entry.message}</div>
                      {entry.node ? <div className="mt-1 text-xs text-slate-500">{entry.node}</div> : null}
                      {entry.details ? (
                        <pre className="mt-3 whitespace-pre-wrap break-words rounded-2xl bg-slate-50 px-4 py-3 text-xs leading-6 text-slate-600">
                          {entry.details}
                        </pre>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {job?.status === 'succeeded' && job.result ? (
          <ResultViewer
            result={job.result}
            onDownloadFinal={handleDownloadFinal}
            onDownloadFinalPdf={handleDownloadFinalPdf}
            onDownloadBundle={handleDownloadBundle}
          />
        ) : null}
      </div>
    </div>
  );
};

export default App;
