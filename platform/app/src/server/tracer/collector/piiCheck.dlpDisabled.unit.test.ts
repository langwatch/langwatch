/**
 * @see specs/setup/memory-footprint.feature — "Google DLP loads its cloud SDK
 * only when enabled and used"
 *
 * When LANGWATCH_DISABLE_GOOGLE_DLP is set, a google_dlp PII check is refused
 * before any DLP work — so the heavy @google-cloud/dlp SDK is never imported.
 */
import { describe, expect, it, vi } from "vitest";

// DLP opted out via env, even though credentials are present.
vi.mock("~/env.mjs", () => ({
  env: {
    LANGWATCH_DISABLE_GOOGLE_DLP: true,
    GOOGLE_APPLICATION_CREDENTIALS: JSON.stringify({
      project_id: "test-project",
      client_email: "svc@test-project.iam.gserviceaccount.com",
    }),
  },
}));

vi.mock("~/server/metrics", () => ({
  getPiiChecksCounter: () => ({ inc: () => undefined }),
  getEvaluationStatusCounter: () => ({ inc: () => undefined }),
  evaluationDurationHistogram: { labels: () => ({ observe: () => undefined }) },
}));

// Vitest evaluates a mock factory the first time the module it stands in for is
// imported, so `loadModule` firing *is* the module being loaded. That is the
// assertion that matters here: "inspectContent was not called" would still pass
// if a regression imported the SDK and constructed a client but never inspected
// anything, and the point of the opt-out is that the heavy dependency is never
// pulled into the process at all.
const { loadModule, constructClient, inspectContentMock } = vi.hoisted(() => ({
  loadModule: vi.fn(),
  constructClient: vi.fn(),
  inspectContentMock: vi.fn(),
}));

vi.mock("@google-cloud/dlp", () => {
  loadModule();
  return {
    DlpServiceClient: class {
      constructor() {
        constructClient();
      }
      inspectContent = inspectContentMock;
    },
  };
});

import { googleDLPClearPII } from "./piiCheck";

describe("googleDLPClearPII", () => {
  describe("when LANGWATCH_DISABLE_GOOGLE_DLP is set", () => {
    /** @scenario "Google DLP loads its cloud SDK only when enabled and used" */
    it("refuses the check without loading the DLP SDK", async () => {
      const obj: Record<string, string> = { field: "call me at 555-123-4567" };

      await expect(
        googleDLPClearPII({
          currentObject: obj,
          lastKey: "field",
          piiRedactionLevel: "STRICT",
        }),
      ).rejects.toThrow(/disabled via LANGWATCH_DISABLE_GOOGLE_DLP/);
      expect(loadModule).not.toHaveBeenCalled();
      expect(constructClient).not.toHaveBeenCalled();
      expect(inspectContentMock).not.toHaveBeenCalled();
    });
  });
});
