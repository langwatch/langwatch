/**
 * @vitest-environment jsdom
 * Model-provider lends its components by the tokens in its client package, so a reader
 * renders them without importing model-provider's browser package (§10.1).
 */
import {
  EditModelProviderFormToken,
  ModelDisplayToken,
  ModelSelectorToken,
} from "@langwatch/model-provider-client";
import { describe, expect, it } from "vitest";

import { modelProviderWeb } from "../model-provider.web.ts";

async function loadLent({ key }: { key: string }) {
  const lend = modelProviderWeb.installation.lends.find(({ token }) => token.key === key);
  return lend && "load" in lend ? lend.load() : undefined;
}

describe("the model-provider browser declaration", () => {
  describe("when a reader looks up each token from model-provider's client", () => {
    /** @scenario Each wave 2 owner lends its components by its client tokens */
    it.each([EditModelProviderFormToken, ModelDisplayToken, ModelSelectorToken])(
      "loads the lent component for $key",
      async (token) => {
        const loaded = await loadLent(token);

        expect(loaded).toHaveProperty("default");
      },
    );
  });
});
