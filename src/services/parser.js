const fs = require('fs');
const path = require('path');

async function parsePDF(filePath) {
  const pdfParse = require('pdf-parse');
  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer);
  return data.text;
}

async function parseDOCX(filePath) {
  const mammoth = require('mammoth');
  const result = await mammoth.extractRawText({ path: filePath });

  if (result.messages && result.messages.length > 0) {
    const warnings = result.messages
      .filter((message) => message.type === 'warning')
      .map((message) => message.message);
    if (warnings.length > 0) {
      console.warn(`[parser] mammoth-advarsler for ${path.basename(filePath)}:`, warnings);
    }
  }

  return result.value;
}

function parsePlainText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return fs.readFileSync(filePath, 'latin1');
  }
}

async function parseFile(filePath, fileType) {
  const ext = fileType.toLowerCase().replace('.', '');

  let text;
  switch (ext) {
    case 'pdf':
      text = await parsePDF(filePath);
      break;
    case 'docx':
      text = await parseDOCX(filePath);
      break;
    case 'txt':
    case 'md':
      text = parsePlainText(filePath);
      break;
    default:
      throw new Error(`Filtype ikke støttet: "${ext}". Bruk PDF, DOCX, TXT eller MD.`);
  }

  return text.replace(/\x00/g, '').trim();
}

module.exports = { parseFile };
