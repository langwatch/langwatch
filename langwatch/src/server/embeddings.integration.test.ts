import { describe, it, expect } from "vitest";
import { getOpenAIEmbeddings } from "./embeddings";

describe("Embeddings API Integration Tests", () => {
  it("should return embeddings for a given text", async () => {
    const text = "The quick brown fox jumps over the lazy dog";
    const embeddings = await getOpenAIEmbeddings(text);

    expect(Array.isArray(embeddings)).toBeTruthy();
    expect(embeddings).toHaveLength(1536);
  });
});
