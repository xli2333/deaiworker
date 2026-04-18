import React from 'react';
import { LockOpenIcon } from '@heroicons/react/24/solid';

interface ApiKeyInputProps {
  value: string;
  isValidating: boolean;
  validationMessage: string | null;
  onChange: (value: string) => void;
  onValidate: () => Promise<void>;
  onClear: () => void;
}

const ApiKeyInput: React.FC<ApiKeyInputProps> = ({
  value,
  isValidating,
  validationMessage,
  onChange,
  onValidate,
  onClear,
}) => (
  <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="flex items-center gap-2 text-sm font-bold text-slate-700">
          <LockOpenIcon className="h-4 w-4 text-report-accent" />
          Gemini API Key
        </div>
        <p className="mt-2 text-xs leading-relaxed text-slate-500">
          只保存在当前浏览器会话中。后端只按次使用，不做长期存储。
        </p>
      </div>
      <button
        type="button"
        onClick={onClear}
        className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-500 transition hover:border-slate-300 hover:text-slate-700"
      >
        清空
      </button>
    </div>

    <div className="mt-4 flex flex-col gap-3 md:flex-row">
      <input
        type="password"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="输入你的 Gemini API Key"
        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-report-accent focus:bg-white focus:ring-2 focus:ring-report-accent/20"
      />
      <button
        type="button"
        onClick={() => void onValidate()}
        disabled={!value.trim() || isValidating}
        className="rounded-xl bg-report-accent px-5 py-3 text-sm font-bold text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isValidating ? '校验中...' : '校验 Key'}
      </button>
    </div>

    {validationMessage ? (
      <div className="mt-3 rounded-xl bg-slate-50 px-4 py-3 text-xs leading-relaxed text-slate-600">{validationMessage}</div>
    ) : null}
  </div>
);

export default ApiKeyInput;
