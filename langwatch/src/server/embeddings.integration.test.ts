import { describe, it, expect } from "vitest";
import { getEmbeddings } from "./embeddings";
import { getTestProject } from "~/utils/testUtils";

describe("Embeddings API Integration Tests", () => {
  it("should return embeddings for a given text", async () => {
    const project = await getTestProject("embeddings-integration-test");
    const text = "The quick brown fox jumps over the lazy dog";
    const embeddings = await getEmbeddings(text, project.id);

    expect(Array.isArray(embeddings)).toBeTruthy();
    expect(embeddings).toHaveLength(1536);
  });
});
