/**
 * Guards that every canonical default in PROVIDER_DEFAULT_MODELS is real: it
 * must be either a "latest" alias (resolved at call-time) or a concrete model
 * id present in the merged registry catalog. A pinned id that no longer exists
 * would make resolveDefaultModel hand back a model the platform cannot run —
 * exactly the `xai/grok-4` regression this test was written to catch.
 */
import { describe, expect, it } from "vitest";
import {
  PROVIDER_DEFAULT_MODELS,
  PROVIDER_RESOLUTION_ORDER,
} from "../modelProvider.constants";
import { isLatestAlias } from "../latestAliases";
import { llmModels } from "../loadModelCatalog";

describe("PROVIDER_DEFAULT_MODELS", () => {
  const registry = llmModels.models;

  it("maps every provider to a real model id (latest alias or registry-backed)", () => {
    for (const [providerId, modelId] of Object.entries(
      PROVIDER_DEFAULT_MODELS,
    )) {
      if (modelId === undefined) continue;

      const resolvable = isLatestAlias(modelId) || modelId in registry;

      expect(
        resolvable,
        `PROVIDER_DEFAULT_MODELS.${providerId} = "${modelId}" is neither a latest alias nor a key in the model registry`,
      ).toBe(true);
    }
  });

  it("keeps PROVIDER_RESOLUTION_ORDER entries that have a default backed by that same guarantee", () => {
    for (const providerId of PROVIDER_RESOLUTION_ORDER) {
      const modelId = PROVIDER_DEFAULT_MODELS[providerId];
      if (modelId === undefined) continue;

      const resolvable = isLatestAlias(modelId) || modelId in registry;

      expect(
        resolvable,
        `PROVIDER_RESOLUTION_ORDER lists "${providerId}" whose default "${modelId}" is not resolvable`,
      ).toBe(true);
    }
  });
});
