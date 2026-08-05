import { describe, expect, it } from "vitest";
import type { LangyModelGroup } from "../logic/langyModelProfile";
import { splitLangyModels } from "../logic/langyModelSuggestions";

const model = (value: string, group: LangyModelGroup) => ({
  value,
  profile: { group },
});

const CATALOGUE = [
  model("openai/gpt-5-mini", "quick"),
  model("openai/gpt-5", "balanced"),
  model("anthropic/claude-sonnet-5", "balanced"),
  model("anthropic/claude-opus-4-8", "reasoning"),
  model("openai/dall-e-3", "multimodal"),
  model("acme/in-house", "custom"),
];

const values = (items: { value: string }[]) => items.map((item) => item.value);

describe("splitLangyModels", () => {
  describe("given a project with several providers enabled", () => {
    it("leads with the Langy default", () => {
      const { suggested } = splitLangyModels({
        items: CATALOGUE,
        langyDefaultModel: "anthropic/claude-sonnet-5",
      });
      expect(values(suggested)[0]).toBe("anthropic/claude-sonnet-5");
    });

    it("offers one representative per primary capability group", () => {
      const { suggested } = splitLangyModels({ items: CATALOGUE });
      expect(values(suggested)).toEqual([
        "openai/gpt-5-mini",
        "openai/gpt-5",
        "anthropic/claude-opus-4-8",
      ]);
    });

    it("never auto-suggests multimodal or custom models", () => {
      const { suggested, more } = splitLangyModels({ items: CATALOGUE });
      expect(values(suggested)).not.toContain("openai/dall-e-3");
      expect(values(suggested)).not.toContain("acme/in-house");
      expect(values(more)).toContain("openai/dall-e-3");
      expect(values(more)).toContain("acme/in-house");
    });

    it("keeps every model reachable across the two lists", () => {
      const { suggested, more } = splitLangyModels({ items: CATALOGUE });
      expect([...values(suggested), ...values(more)].sort()).toEqual(
        values(CATALOGUE).sort(),
      );
    });
  });

  describe("given the user has already chosen a model", () => {
    it("shows their choice without making them open More to find it", () => {
      const { suggested } = splitLangyModels({
        items: CATALOGUE,
        selectedModel: "acme/in-house",
      });
      expect(values(suggested)).toContain("acme/in-house");
    });
  });

  describe("given the user is searching", () => {
    it("hides nothing behind a disclosure", () => {
      const { suggested, more } = splitLangyModels({
        items: CATALOGUE,
        langyDefaultModel: "openai/gpt-5",
        searching: true,
      });
      expect(suggested).toEqual([]);
      expect(values(more)).toEqual(values(CATALOGUE));
    });
  });

  describe("given a project with barely any models", () => {
    it("does not split, because a shortlist of one is just the list again", () => {
      const items = [model("openai/gpt-5", "balanced")];
      const { suggested, more } = splitLangyModels({
        items,
        langyDefaultModel: "openai/gpt-5",
      });
      expect(suggested).toEqual([]);
      expect(more).toEqual(items);
    });
  });

  describe("given no models have arrived yet", () => {
    it("splits nothing", () => {
      const { suggested, more } = splitLangyModels({ items: [] });
      expect(suggested).toEqual([]);
      expect(more).toEqual([]);
    });
  });
});
