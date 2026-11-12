/**
 * @see specs/model-providers/model-picker-callable-ids.feature
 */
import { describe, expect, it } from "vitest";

import { ModelProviderModelList } from "../../features/served-models/services/http-model-provider-model-list.service.ts";
import { createModelProviderTestApp } from "./model-provider.fixture.ts";

/** A model list that records every credential it was asked about. */
class RecordingModelList extends ModelProviderModelList {
  readonly asked: { provider: string; customKeys: Record<string, unknown> }[] = [];

  constructor(private readonly ids: string[]) {
    super();
  }

  findServedModelIds(input: {
    provider: string;
    customKeys: Record<string, unknown>;
  }): Promise<string[]> {
    this.asked.push(input);
    return Promise.resolve(this.ids);
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("given a project with an OpenAI provider", () => {
  describe("when the provider is saved", () => {
    /** @scenario Saving a provider asks its model list again */
    it("asks its model list with the stored key", async () => {
      const modelList = new RecordingModelList(["gpt-6-sol"]);
      const app = createModelProviderTestApp({ infrastructure: { modelList } });

      await app.upsertUnattributed({
        projectId: "project-1",
        provider: "openai",
        enabled: true,
        customKeys: { OPENAI_API_KEY: "sk-test" },
      });
      await settle();

      expect(modelList.asked).toEqual([
        { provider: "openai", customKeys: expect.objectContaining({ OPENAI_API_KEY: "sk-test" }) },
      ]);
    });
  });

  describe("when the pickers ask which models it serves", () => {
    /** @scenario The provider list the pickers read carries each provider's served models */
    it("answers the provider's list per provider key", async () => {
      const app = createModelProviderTestApp({
        infrastructure: { modelList: new RecordingModelList(["gpt-6-sol"]) },
      });
      await app.upsertUnattributed({
        projectId: "project-1",
        provider: "openai",
        enabled: true,
        customKeys: { OPENAI_API_KEY: "sk-test" },
      });

      await expect(app.getServedModelsForProject({ projectId: "project-1" })).resolves.toEqual({
        openai: ["gpt-6-sol"],
      });
    });
  });

  describe("when the deployment composed no model list", () => {
    it("answers no list, so the pickers keep the catalogue", async () => {
      const app = createModelProviderTestApp();

      await expect(app.getServedModelsForProject({ projectId: "project-1" })).resolves.toEqual({});
    });
  });
});
