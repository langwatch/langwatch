import { describe, expect, it } from "vitest";

import { toLangevalsContexts } from "../langevals-contexts.rules.ts";

const chunks = [
  { document_id: "kb-returns-01", chunk_id: "0", content: "Returns: unused items within 30 days." },
  { document_id: "kb-returns-02", chunk_id: "1", content: "Used tents cannot be returned." },
];

describe("toLangevalsContexts", () => {
  describe("given RAG chunk objects from a trace mapping", () => {
    /** @scenario "RAG contexts reach langevals as the chunks' text" */
    it("sends each chunk's content, not its JSON envelope", () => {
      expect(toLangevalsContexts(JSON.stringify(chunks))).toEqual([
        "Returns: unused items within 30 days.",
        "Used tents cannot be returned.",
      ]);
      expect(toLangevalsContexts(chunks)).toEqual([
        "Returns: unused items within 30 days.",
        "Used tents cannot be returned.",
      ]);
    });

    /** @scenario "RAG contexts reach langevals as the chunks' text" */
    it("reads a chunk that arrives JSON-encoded inside the list", () => {
      expect(toLangevalsContexts(chunks.map((chunk) => JSON.stringify(chunk)))).toEqual([
        "Returns: unused items within 30 days.",
        "Used tents cannot be returned.",
      ]);
    });

    it("renders structured chunk content as text", () => {
      expect(toLangevalsContexts([{ document_id: "d", content: { price: 10 } }])).toEqual([
        '{"price":10}',
      ]);
    });
  });

  describe("given plain string contexts", () => {
    it("keeps them as they are", () => {
      expect(toLangevalsContexts(["first", "second"])).toEqual(["first", "second"]);
      expect(toLangevalsContexts('["first","second"]')).toEqual(["first", "second"]);
      expect(toLangevalsContexts("just one context")).toEqual(["just one context"]);
    });
  });

  describe("given an unmapped or empty contexts field", () => {
    /** @scenario "RAG contexts reach langevals as the chunks' text" */
    it("sends no contexts rather than one empty string", () => {
      expect(toLangevalsContexts("")).toEqual([]);
      expect(toLangevalsContexts("[]")).toEqual([]);
      expect(toLangevalsContexts(undefined)).toBeUndefined();
      expect(toLangevalsContexts(null)).toBeUndefined();
    });
  });
});
