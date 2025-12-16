export function quantizeEmbedding(embedding: number[]): number[] {
  return embedding.map(x => Math.round((x + 1) * 127.5)); // to uint8
}

export function dequantizeEmbedding(qEmbedding: number[]): number[] {
  return qEmbedding.map(x => (x / 127.5) - 1);
}

/**
 * Returns cosine distance between two embeddings. 
 * Embeddings should be dequantized floats
 * 
 * @param {number[]} A array of float values, a vector embedding
 * @param {number[]} B array of float values, a vector embedding
 */
export function cosineSimilarity(A: number[], B: number[]): number {
  if (A.length !== B.length) {
    throw new Error("Vectors must be the same length");
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < A.length; i++) {
    dotProduct += A[i] * B[i];
    normA += A[i] * A[i];
    normB += B[i] * B[i];
  }

  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);

  if (normA === 0 || normB === 0) {
    return 0; // or handle zero-vector case as needed
  }

  return dotProduct / (normA * normB);
}