import { describe, expect, it } from "vitest";

import { humanize } from "../model-provider-write.rules.ts";

describe("humanize", () => {
  describe("given a provider the registry names", () => {
    it("names a new Codex row the way the drawer and the add list do", () => {
      expect(humanize("openai_codex")).toBe("Codex (OpenAI account)");
    });

    it("keeps the registry's own casing", () => {
      expect(humanize("openai")).toBe("OpenAI");
      expect(humanize("azure")).toBe("Azure OpenAI");
    });
  });

  describe("given a provider the registry does not know", () => {
    it("title-cases the key", () => {
      expect(humanize("some_new_vendor")).toBe("Some New Vendor");
    });
  });
});
