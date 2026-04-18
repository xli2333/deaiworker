import React, { useMemo, useState } from 'react';
import type { DeAiJobResult } from '../types';

type TabId =
  | 'original'
  | 'parsed'
  | 'humanizerInitial'
  | 'humanized'
  | 'humanizerFinal'
  | 'auditInitial'
  | 'audited'
  | 'auditFinal'
  | 'finalPolished'
  | 'finalMarkupPlan'
  | 'final';

interface ResultViewerProps {
  result: DeAiJobResult;
  onDownloadFinal: () => void;
  onDownloadFinalPdf: () => void;
  onDownloadBundle: () => void;
}

const tabLabelMap: Record<TabId, string> = {
  original: '原文',
  parsed: '解析文本',
  humanizerInitial: '去AI全量初检',
  humanized: '去AI全量修订稿',
  humanizerFinal: '去AI全量复检',
  auditInitial: '审计全量初检',
  audited: '审计全量修订稿',
  auditFinal: '审计全量复检',
  finalPolished: '终修正文',
  finalMarkupPlan: '标记计划',
  final: '终稿',
};

const ResultViewer: React.FC<ResultViewerProps> = ({
  result,
  onDownloadFinal,
  onDownloadFinalPdf,
  onDownloadBundle,
}) => {
  const [activeTab, setActiveTab] = useState<TabId>('final');

  const tabContent = useMemo<Record<TabId, string>>(
    () => ({
      original: result.originalText,
      parsed: result.parsedText,
      humanizerInitial: result.humanizerInitialReport,
      humanized: result.humanizedText,
      humanizerFinal: result.humanizerFinalReport,
      auditInitial: result.auditInitialReport,
      audited: result.auditedText,
      auditFinal: result.auditFinalReport,
      finalPolished: result.finalPolishedText || '',
      finalMarkupPlan: result.finalMarkupPlanJson ? JSON.stringify(result.finalMarkupPlanJson, null, 2) : '',
      final: result.finalText,
    }),
    [result]
  );

  return (
    <div className="animate-fade-in rounded-[28px] border border-slate-200 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.06)]">
      <div className="flex flex-col gap-4 border-b border-slate-100 px-6 py-5 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="font-serif text-2xl font-bold text-slate-900">{result.fileName}</h2>
          <p className="mt-2 text-sm text-slate-500">
            解析方式：{result.parseMeta.extractedBy} · {result.parseMeta.characterCount} 字符 · {result.parseMeta.paragraphCount} 段
          </p>
          <p className="mt-1 text-xs text-slate-400">产物目录：{result.outputDir}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={onDownloadBundle}
            className="rounded-xl border border-slate-200 px-5 py-3 text-sm font-bold text-slate-700 transition hover:border-slate-300 hover:text-slate-900"
          >
            下载结果包
          </button>
          <button
            type="button"
            onClick={onDownloadFinal}
            className="rounded-xl bg-report-accent px-5 py-3 text-sm font-bold text-white transition hover:bg-teal-800"
          >
            下载终稿
          </button>
          {result.finalPdfArtifact ? (
            <button
              type="button"
              onClick={onDownloadFinalPdf}
              className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white transition hover:bg-slate-700"
            >
              下载 PDF
            </button>
          ) : null}
        </div>
      </div>

      <div className="border-b border-slate-100 px-4 py-3">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(tabLabelMap) as TabId[]).map((tabId) => (
            <button
              key={tabId}
              type="button"
              onClick={() => setActiveTab(tabId)}
              className={`rounded-full px-4 py-2 text-sm font-bold transition ${
                activeTab === tabId
                  ? 'bg-report-accent text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {tabLabelMap[tabId]}
            </button>
          ))}
        </div>
      </div>

      <div className="px-6 py-6">
        <div className="rounded-3xl bg-slate-950 px-5 py-5 text-sm leading-7 text-slate-100 shadow-inner">
          <pre className="pretty-scrollbar max-h-[70vh] overflow-auto whitespace-pre-wrap break-words font-sans">
            {tabContent[activeTab] || '当前标签页没有内容。'}
          </pre>
        </div>
      </div>
    </div>
  );
};

export default ResultViewer;
