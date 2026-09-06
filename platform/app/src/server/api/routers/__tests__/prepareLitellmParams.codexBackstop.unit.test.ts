/**
 * The execution backstop for the terms-restricted codex provider
 * (spec: specs/model-providers/codex-account-provider.feature, "The server
 * refuses Codex outside the allowed surfaces").
 *
 * Both wire formats must fail closed: the legacy `openai_codex/<model>`
 * prefix AND the canonical `mp_<row-id>/<model>` value, which names the row
 * rather than the provider and therefore sails past any prefix check. The
 * canonical case is the handcrafted-request route: submit a codex row's
 * canonical value to /api/playground and the route resolves the row itself,
 * so the guard has to read the RESOLVED provider, not the model string.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("~/server/db", () => ({ prisma: {} }));
vi.mock("~/env.mjs", () => ({ env: {} }));

import type { MaybeStoredModelProvider } from "../../../modelProviders/registry";
import { prepareLitellmParams } from "../modelProviders.utils";

const codexRow = {
  id: "mp_codexrow123",
  provider: "openai_codex",
  enabled: true,
  customKeys: { CODEX_ACCESS_TOKEN: "oauth-access-token" },
  customModels: null,
  customEmbeddingsModels: null,
  models: ["gpt-5.6-terra"],
  disabledByDefault: false,
} as unknown as MaybeStoredModelProvider;

describe("prepareLitellmParams codex backstop", () => {
  describe("when the wire value carries the legacy codex prefix", () => {
    it("refuses to build litellm params", async () => {
      await expect(
        prepareLitellmParams({
          model: "openai_codex/gpt-5.6-terra",
          modelProvider: codexRow,
          projectId: "project-1",
        }),
      ).rejects.toThrow(/coding-assistant surfaces only/);
    });
  });

  describe("when the wire value is the canonical row format", () => {
    it("refuses on the resolved codex row, closing the mp_ bypass", async () => {
      await expect(
        prepareLitellmParams({
          model: "mp_codexrow123/gpt-5.6-terra",
          modelProvider: codexRow,
          projectId: "project-1",
        }),
      ).rejects.toThrow(/coding-assistant surfaces only/);
    });
  });
});
