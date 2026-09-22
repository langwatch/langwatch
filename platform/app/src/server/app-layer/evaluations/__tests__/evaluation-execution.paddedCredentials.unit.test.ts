/**
 * @vitest-environment node
 *
 * End-to-end guard for the credential-whitespace fix.
 *
 * A credential pasted with padding is stored padded. Spent as a query
 * parameter it is percent-encoded and the provider ignores it, which is why
 * the settings page reports a working connection; spent as an HTTP header it
 * is refused before the request leaves the process, so every evaluation
 * against that provider fails with `Illegal header value`. This drives the
 * path an evaluation actually takes and asserts the key reaching the worker
 * carries no padding.
 *
 * Only the database is mocked. `ModelProviderService`, the repository,
 * `readCustomKeys` and `prepareLitellmParams` all run for real, so the trim
 * under test is the one production uses.
 *
 * Credential bytes are never logged. `GEMINI_API_KEY` resolves from
 * `process.env` when the stored row does not supply it, which would let this
 * pass on an ambient key and prove nothing, so the value is a sentinel and is
 * asserted to be the stored one.
 */

import { describe, expect, it, vi } from "vitest";
import { encrypt } from "~/utils/encryption";

const STORED_KEY = "sentinel-stored-value";
const PADDED_KEY = ` ${STORED_KEY}`;

const project = {
  id: "project_1",
  teamId: "team_1",
  team: { organizationId: "org_1" },
};

vi.mock("~/server/db", () => ({
  prisma: {
    project: { findUnique: vi.fn(async () => project) },
    modelProvider: {
      findMany: vi.fn(async () => [
        {
          id: "mp_1",
          provider: "gemini",
          enabled: true,
          customKeys: encrypt(JSON.stringify({ GEMINI_API_KEY: PADDED_KEY })),
          customModels: null,
          customEmbeddingsModels: null,
          deploymentMapping: null,
          extraHeaders: null,
          scopes: [{ projectId: "project_1" }],
        },
      ]),
    },
  },
}));

import { setupModelEnv } from "../evaluation-execution.factories";

describe("setupModelEnv", () => {
  describe("given a stored credential with leading whitespace", () => {
    it("hands the evaluator a key with the padding stripped", async () => {
      const env = await setupModelEnv(
        "gemini/gemini-2.5-pro",
        false,
        "project_1",
      );
      const apiKey = env.X_LITELLM_api_key;

      // Fails loudly if the key came from process.env instead of the row,
      // which would make the assertion below vacuous.
      expect([STORED_KEY, PADDED_KEY]).toContain(apiKey);

      expect(apiKey).toBe(STORED_KEY);
    });
  });
});
