// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { describe, expect, it } from "vitest";

import { ModelProviderAiToolCatalogService } from "../ai-tool-provider-catalog.service.ts";

describe("ModelProviderAiToolCatalogService", () => {
  describe("when the catalogue is listed", () => {
    it("answers every registry provider with its key, name and type", () => {
      const providers = ModelProviderAiToolCatalogService.create().findAll();

      expect(providers.length).toBeGreaterThan(0);
      expect(providers).toContainEqual(
        expect.objectContaining({ providerKey: "custom", type: "llm" }),
      );
    });
  });
});
