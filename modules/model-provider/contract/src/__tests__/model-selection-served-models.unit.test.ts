/**
 * @see specs/model-providers/model-picker-callable-ids.feature
 */
import { describe, expect, it } from "vitest";

import { allModelOptions } from "../model-options.ts";
import type { ModelProviderEditorValue } from "../model-provider-registry.ts";
import { modelSelectionFrom } from "../model-selection.ts";

const offered = (providers: ModelProviderEditorValue[]): string[] =>
  modelSelectionFrom({
    providers,
    options: allModelOptions,
    mode: "chat",
    featureKey: undefined,
  }).selectOptions.map((option) => option.value);

const openai = (overrides: Partial<ModelProviderEditorValue> = {}): ModelProviderEditorValue => ({
  provider: "openai",
  enabled: true,
  ...overrides,
});

describe("given an OpenAI provider in a chat picker", () => {
  describe("when its own model list is known", () => {
    /** @scenario A catalogue model the provider's own list does not carry is not offered */
    it("offers only the catalogue ids the list carries", () => {
      const ids = offered([openai({ servedModels: ["gpt-4.1", "gpt-6-sol", "whisper-1"] })]);

      expect(ids).toContain("openai/gpt-4.1");
      expect(ids).toContain("openai/gpt-6-sol");
      expect(allModelOptions).toContain("openai/gpt-oss-120b");
      expect(ids).not.toContain("openai/gpt-oss-120b");
      const openaiIds = ids.filter((id) => id.startsWith("openai/") && !id.includes("latest"));
      expect(openaiIds.toSorted()).toEqual(["openai/gpt-4.1", "openai/gpt-6-sol"]);
    });

    /** @scenario Custom models are offered whatever the provider's list says */
    it("still offers a custom model the list does not carry", () => {
      const ids = offered([
        openai({
          servedModels: ["gpt-4.1"],
          customModels: [{ modelId: "my-finetune", displayName: "Mine", mode: "chat" }],
        }),
      ]);

      expect(ids).toContain("openai/my-finetune");
    });
  });

  describe("when its own model list is not known", () => {
    /** @scenario The catalogue is offered when the provider's list is not known */
    it("offers every catalogue chat model the picker offered before", () => {
      const unknown = offered([openai({ servedModels: null })]);
      const absent = offered([openai()]);

      expect(unknown).toEqual(absent);
      expect(unknown).toContain("openai/gpt-oss-120b");
    });
  });

  describe("when its list shares no id with the catalogue", () => {
    /** @scenario A list that shares no id with the catalogue is ignored */
    it("keeps the catalogue rather than emptying the provider", () => {
      expect(offered([openai({ servedModels: ["team-alias-a", "team-alias-b"] })])).toEqual(
        offered([openai()]),
      );
    });
  });
});

describe("given the catalogue's audio, realtime, image and deep research models", () => {
  describe("when the chat picker options are built", () => {
    /** @scenario Audio, realtime, image and deep research models are not offered for chat */
    it("offers none of them and keeps the router", () => {
      const ids = offered([openai(), { provider: "openrouter", enabled: true }]);

      for (const id of [
        "openai/gpt-audio",
        "openai/gpt-realtime",
        "openai/gpt-5-image",
        "openai/o3-deep-research",
      ]) {
        expect(allModelOptions, id).toContain(id);
        expect(ids, id).not.toContain(id);
      }
      expect(ids).toContain("openai/gpt-4o");
      expect(ids).toContain("openrouter/auto");
    });
  });
});
