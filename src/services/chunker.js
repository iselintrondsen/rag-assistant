const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 200;
const MIN_CONTENT = 8;

function isHeading(line) {
  if (!line || line.length < 2) return false;
  if (/^#{1,6}\s+/.test(line)) return true;
  if (/^\d+(\.\d+)*\.?\s+[A-ZÆØÅ]/.test(line)) return true;

  const stripped = line.replace(/[^A-ZÆØÅA-ZA-Z]/g, '');
  return stripped.length >= 4 && stripped === stripped.toUpperCase() && line.length <= 80;
}

function computeOverlap(text) {
  if (!text) return '';
  const overlapLen = Math.min(CHUNK_OVERLAP, Math.floor(text.length * 0.15));
  return text.slice(-overlapLen);
}

function chunkBySentences(text) {
  const sentences = text
    .split(/(?<=[.!?:])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= MIN_CONTENT || /\S/.test(s));

  const chunks = [];
  let current = '';

  for (const sentence of sentences) {
    const tentative = current ? `${current} ${sentence}` : sentence;
    if (tentative.length > CHUNK_SIZE) {
      if (current.trim()) chunks.push(current.trim());
      current = sentence;
    } else {
      current = tentative;
    }
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

function chunkText(text) {
  if (!text || text.trim().length === 0) return [];

  const cleaned = text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const blocks = cleaned
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length >= MIN_CONTENT || /\S/.test(p));

  if (blocks.length === 0) return [];

  const chunks = [];
  let current = '';

  const flushCurrent = () => {
    if (current.trim().length >= MIN_CONTENT) {
      chunks.push(current.trim());
    }
    current = '';
  };

  for (const block of blocks) {
    const firstLine = block.split('\n')[0];

    if (isHeading(firstLine) && current.trim().length >= MIN_CONTENT) {
      flushCurrent();
      const overlap = computeOverlap(chunks[chunks.length - 1] || '');
      current = overlap ? `${overlap}\n\n${block}` : block;
      continue;
    }

    if (block.length > CHUNK_SIZE) {
      flushCurrent();
      const sentenceChunks = chunkBySentences(block);
      chunks.push(...sentenceChunks);
      current = computeOverlap(sentenceChunks[sentenceChunks.length - 1] || '');
      continue;
    }

    const tentative = current ? `${current}\n\n${block}` : block;
    if (tentative.length > CHUNK_SIZE) {
      flushCurrent();
      const overlap = computeOverlap(chunks[chunks.length - 1] || '');
      current = overlap ? `${overlap}\n\n${block}` : block;
    } else {
      current = tentative;
    }
  }

  if (current.trim().length >= MIN_CONTENT) {
    chunks.push(current.trim());
  }

  return chunks;
}

module.exports = { chunkText };
