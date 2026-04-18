export interface UploadedFilePayload {
  name: string;
  mimeType: string;
  data: string;
  isText: boolean;
}

export interface ParseMeta {
  mimeType: string;
  extractedBy: string;
  characterCount: number;
  paragraphCount: number;
}

export interface DeAiJobHistoryEntry {
  id: string;
  at: string;
  type: 'lifecycle' | 'status' | 'error';
  node?: string;
  message: string;
  details?: string;
}

export interface DeAiReviewIssue {
  title: string;
  severity: string;
  diagnosis?: string;
  instruction?: string;
  excerpt?: string;
  category?: string;
  scope?: string;
}

export interface DeAiReviewState {
  stageKey: string;
  stageLabel: string;
  summary: string;
  ready?: string;
  verdict?: string;
  unresolvedRisk?: string;
  parserStatus?: string;
  parserError?: string;
  issues: DeAiReviewIssue[];
}

export interface DeAiJobResult {
  taskId: string;
  fileName: string;
  parseMeta: ParseMeta;
  originalText: string;
  parsedText: string;
  humanizerInitialReport: string;
  humanizedText: string;
  humanizerFinalReport: string;
  auditInitialReport: string;
  auditedText: string;
  auditFinalReport: string;
  finalPolishedText?: string;
  finalMarkupPlanJson?: Record<string, unknown>;
  finalMarkupApplyMeta?: {
    appliedTransforms?: Array<Record<string, unknown>>;
    rejectedTransforms?: Array<Record<string, unknown>>;
  };
  finalText: string;
  outputDir: string;
  artifactFiles: string[];
  finalPdfArtifact?: string;
  pdfExport?: {
    ok: boolean;
    error?: string;
    command?: string;
    pdfPath?: string;
  };
  workflowMeta?: {
    humanizerRoundsUsed?: number;
    auditRoundsUsed?: number;
    finalSkipped?: boolean;
    finalPolishBypassed?: boolean;
    finalMarkupTransformsPlanned?: number;
    finalMarkupTransformsApplied?: number;
    finalMarkupTransformsRejected?: number;
  };
  humanizerInitialReportData?: Record<string, unknown>;
  humanizerFinalReportData?: Record<string, unknown>;
  auditInitialReportData?: Record<string, unknown>;
  auditFinalReportData?: Record<string, unknown>;
}

export interface DeAiJob {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string;
  message?: string;
  currentNode?: string;
  error?: string;
  errorDetails?: string;
  history?: DeAiJobHistoryEntry[];
  reviewState?: DeAiReviewState;
  result?: DeAiJobResult;
}
