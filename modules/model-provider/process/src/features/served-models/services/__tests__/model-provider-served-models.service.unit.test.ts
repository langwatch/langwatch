/**
 * @see specs/model-providers/model-picker-callable-ids.feature
 */
import { describe, expect, it } from "vitest";

import { MemoryModelProviderServedModelsRepository } from "../../../../repositories/memory/memory.model-provider-served-models.repository.ts";
import { ModelProviderModelList } from "../http-model-provider-model-list.service.ts";
import {
  ModelProviderServedModelsService,
  servedModelsKey,
} from "../model-provider-served-models.service.ts";

/** A model list that answers what the suite decided and counts how often it was asked. */
class ScriptedModelList extends ModelProviderModelList {
  asked = 0;

  constructor(private readonly answer: () => Promise<string[]>) {
    super();
  }

  findServedModelIds(): Promise<string[]> {
    this.asked += 1;
    return this.answer();
  }
}

const OPENAI = { provider: "openai", customKeys: { OPENAI_API_KEY: "sk-test" } };
const HOUR_MS = 60 * 60 * 1000;

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("given a provider credential nobody listed yet", () => {
  describe("when the picker reads the provider list", () => {
    it("asks the provider once and answers its ids", async () => {
      const modelList = new ScriptedModelList(async () => ["gpt-6-sol"]);
      const service = ModelProviderServedModelsService.create({
        modelList,
        listings: MemoryModelProviderServedModelsRepository.create(),
      });

      expect(await service.getServedModels([OPENAI])).toEqual({ openai: ["gpt-6-sol"] });
      expect(await service.getServedModels([OPENAI])).toEqual({ openai: ["gpt-6-sol"] });
      expect(modelList.asked).toBe(1);
    });
  });

  describe("when the first listing takes longer than the picker waits", () => {
    /** @scenario A slow first listing does not hold the picker */
    it("answers without it and holds it for the next read", async () => {
      let release: (ids: string[]) => void = () => undefined;
      const modelList = new ScriptedModelList(
        () => new Promise<string[]>((resolve) => (release = resolve)),
      );
      const service = ModelProviderServedModelsService.create({
        modelList,
        listings: MemoryModelProviderServedModelsRepository.create(),
        firstListWaitMs: 5,
      });

      expect(await service.getServedModels([OPENAI])).toEqual({});
      release(["gpt-6-sol"]);
      await settle();
      expect(await service.getServedModels([OPENAI])).toEqual({ openai: ["gpt-6-sol"] });
      expect(modelList.asked).toBe(1);
    });
  });
});

describe("given a provider whose list request failed", () => {
  describe("when the picker reads the provider list again", () => {
    /** @scenario A provider that does not answer is not asked on every read */
    it("answers no list and does not ask again", async () => {
      const modelList = new ScriptedModelList(() => Promise.reject(new Error("unreachable")));
      const service = ModelProviderServedModelsService.create({
        modelList,
        listings: MemoryModelProviderServedModelsRepository.create(),
      });

      expect(await service.getServedModels([OPENAI])).toEqual({});
      expect(await service.getServedModels([OPENAI])).toEqual({});
      expect(modelList.asked).toBe(1);
    });
  });
});

describe("given a list fetched more than six hours ago", () => {
  describe("when the picker reads the provider list", () => {
    /** @scenario A known list is answered from the cache and asked again once it is old */
    it("answers the held list and asks again in the background", async () => {
      const listings = MemoryModelProviderServedModelsRepository.create();
      await listings.saveListing({
        key: servedModelsKey(OPENAI),
        ids: ["gpt-4.1"],
        listedAt: Date.now() - 7 * HOUR_MS,
        ttlSeconds: 3600,
      });
      const modelList = new ScriptedModelList(async () => ["gpt-6-sol"]);
      const service = ModelProviderServedModelsService.create({ modelList, listings });

      expect(await service.getServedModels([OPENAI])).toEqual({ openai: ["gpt-4.1"] });
      await settle();
      expect(modelList.asked).toBe(1);
      expect(await service.getServedModels([OPENAI])).toEqual({ openai: ["gpt-6-sol"] });
    });
  });
});

describe("given a held list", () => {
  describe("when the provider is refreshed after a save", () => {
    /** @scenario Saving a provider asks its model list again */
    it("asks again and holds the new answer", async () => {
      const answers = [["gpt-4.1"], ["gpt-4.1", "gpt-6-sol"]];
      const modelList = new ScriptedModelList(async () => answers.shift() ?? []);
      const service = ModelProviderServedModelsService.create({
        modelList,
        listings: MemoryModelProviderServedModelsRepository.create(),
      });
      await service.getServedModels([OPENAI]);

      await service.refresh(OPENAI);

      expect(await service.getServedModels([OPENAI])).toEqual({ openai: ["gpt-4.1", "gpt-6-sol"] });
    });
  });

  describe("when the credential's key changes", () => {
    it("is a different listing", () => {
      expect(servedModelsKey(OPENAI)).not.toBe(
        servedModelsKey({ provider: "openai", customKeys: { OPENAI_API_KEY: "sk-other" } }),
      );
    });
  });
});
