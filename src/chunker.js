// Chunk text into overlapping segments with metadata.
// Each chunk: { text, source, chunkIndex, totalChunks, charStart, charEnd }

export function chunkText(text, {
  chunkSize = 500,
  overlap = 100,
  source = 'unknown',
} = {}) {
  if (typeof text !== 'string' || text.length === 0) {
    return [];
  }
  if (chunkSize <= 0) throw new Error('chunkSize must be > 0');
  if (overlap < 0) throw new Error('overlap must be >= 0');
  if (overlap >= chunkSize) throw new Error('overlap must be < chunkSize');

  const chunks = [];
  const step = chunkSize - overlap;
  let i = 0;
  while (i < text.length) {
    const end = Math.min(i + chunkSize, text.length);
    chunks.push({
      text: text.slice(i, end),
      source,
      chunkIndex: chunks.length,
      charStart: i,
      charEnd: end,
    });
    if (end >= text.length) break;
    i += step;
  }

  // Stamp totalChunks
  const total = chunks.length;
  for (const c of chunks) {
    c.totalChunks = total;
  }
  return chunks;
}
