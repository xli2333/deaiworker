import mammoth from 'mammoth';

let pdfParseLoader = null;

const cleanText = (text = '') =>
  String(text)
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const countParagraphs = (text) =>
  cleanText(text)
    .split(/\n\s*\n/g)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean).length;

const loadPdfParser = async () => {
  if (!pdfParseLoader) {
    pdfParseLoader = import('pdf-parse').then((module) => {
      const candidate = module;
      return async (buffer) => {
        const parser = new candidate.PDFParse({ data: buffer });
        try {
          const result = await parser.getText();
          return cleanText(result?.text || '');
        } finally {
          await parser.destroy().catch(() => undefined);
        }
      };
    });
  }

  return await pdfParseLoader;
};

const parsePdf = async (buffer) => {
  const extract = await loadPdfParser();
  return await extract(buffer);
};

const parseDocx = async (buffer) => {
  const result = await mammoth.extractRawText({ buffer });
  return cleanText(result.value || '');
};

export const parseUploadedDocument = async (file) => {
  if (!file || typeof file !== 'object') {
    throw new Error('缺少上传文件。');
  }

  const name = String(file.name || '').trim() || 'document';
  const mimeType = String(file.mimeType || '').trim() || 'application/octet-stream';
  const isText = Boolean(file.isText);
  let originalText = '';
  let extractedBy = 'raw_text';

  if (isText) {
    originalText = cleanText(String(file.data || ''));
  } else if (mimeType === 'application/pdf') {
    extractedBy = 'pdf_parse';
    originalText = await parsePdf(Buffer.from(String(file.data || ''), 'base64'));
  } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    extractedBy = 'mammoth_docx';
    originalText = await parseDocx(Buffer.from(String(file.data || ''), 'base64'));
  } else {
    throw new Error(`暂不支持的文件类型：${mimeType}`);
  }

  const parsedText = cleanText(originalText);
  if (!parsedText) {
    throw new Error(`未能从文件 ${name} 中解析出有效文本。`);
  }

  return {
    originalText,
    parsedText,
    parseMeta: {
      mimeType,
      extractedBy,
      characterCount: parsedText.length,
      paragraphCount: countParagraphs(parsedText),
    },
  };
};
