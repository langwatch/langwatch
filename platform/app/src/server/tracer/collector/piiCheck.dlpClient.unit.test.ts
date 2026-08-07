/**
 * @see specs/setup/memory-footprint.feature — "Google DLP loads its cloud SDK
 * only when enabled and used"
 *
 * The SDK is imported on first use rather than at boot, which makes creating
 * the client asynchronous. Checks that arrive while that import is still in
 * flight have to join it rather than each constructing their own client: every
 * extra client holds a gRPC channel that nothing ever closes.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { constructClient, inspectContentMock } = vi.hoisted(() => ({
  constructClient: vi.fn(),
  inspectContentMock: vi.fn(),
}));

vi.mock("@google-cloud/dlp", () => ({
  DlpServiceClient: class {
    constructor() {
      constructClient();
    }
    inspectContent = inspectContentMock;
  },
}));

vi.mock("~/env.mjs", () => ({
  env: {
    GOOGLE_APPLICATION_CREDENTIALS: JSON.stringify({
      project_id: "test-project",
    }),
  },
}));

vi.mock("~/server/metrics", () => ({
  getPiiChecksCounter: () => ({ inc: () => undefined }),
  getEvaluationStatusCounter: () => ({ inc: () => undefined }),
  evaluationDurationHistogram: { labels: () => ({ observe: () => undefined }) },
}));

import { googleDLPClearPII } from "./piiCheck";

describe("googleDLPClearPII", () => {
  beforeEach(() => {
    inspectContentMock.mockResolvedValue([{ result: { findings: [] } }]);
  });

  describe("given no DLP client has been created yet", () => {
    describe("when several checks start before the SDK import settles", () => {
      it("creates exactly one client for all of them", async () => {
        // Started without awaiting in between, so every call reaches the client
        // getter while the dynamic import of the SDK is still pending.
        const checks = Array.from({ length: 5 }, (_, index) =>
          googleDLPClearPII({
            currentObject: { value: `subject ${index}` },
            lastKey: "value",
            piiRedactionLevel: "STRICT",
          }),
        );

        await Promise.all(checks);

        expect(constructClient).toHaveBeenCalledTimes(1);
        expect(inspectContentMock).toHaveBeenCalledTimes(5);
      });
    });
  });
});
