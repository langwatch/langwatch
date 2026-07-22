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

// If DLP were loaded despite the opt-out, requiring this class would run the
// real SDK; the mock proves the test never reaches it, but keeps the import
// resolvable.
const inspectContentMock = vi.fn();
vi.mock("@google-cloud/dlp", () => ({
  DlpServiceClient: class {
    inspectContent = inspectContentMock;
  },
}));

import { googleDLPClearPII } from "./piiCheck";

describe("googleDLPClearPII", () => {
  describe("when LANGWATCH_DISABLE_GOOGLE_DLP is set", () => {
    it("refuses the check without inspecting content", async () => {
      const obj: Record<string, string> = { field: "call me at 555-123-4567" };

      await expect(googleDLPClearPII(obj, "field", "STRICT")).rejects.toThrow(
        /disabled via LANGWATCH_DISABLE_GOOGLE_DLP/,
      );
      expect(inspectContentMock).not.toHaveBeenCalled();
    });
  });
});
