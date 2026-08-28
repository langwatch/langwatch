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

const { closeMock, constructClient, inspectContentMock } = vi.hoisted(() => ({
  closeMock: vi.fn(),
  constructClient: vi.fn(),
  inspectContentMock: vi.fn(),
}));

vi.mock("@google-cloud/dlp", () => ({
  DlpServiceClient: class {
    constructor(options: unknown) {
      constructClient(options);
    }
    inspectContent = inspectContentMock;
    close = closeMock;
  },
}));

vi.mock("~/server/metrics", () => ({
  getPiiChecksCounter: () => ({ inc: () => undefined }),
  getEvaluationStatusCounter: () => ({ inc: () => undefined }),
  evaluationDurationHistogram: { labels: () => ({ observe: () => undefined }) },
}));

import { AppPiiRedactionTransport } from "./piiCheck";
import { resolveTracePrivacyRuntimeConfig } from "~/runtime/trace-privacy.config";

describe("AppPiiRedactionTransport", () => {
  beforeEach(() => {
    constructClient.mockReset();
    closeMock.mockReset();
    inspectContentMock.mockReset();
    inspectContentMock.mockResolvedValue([{ result: { findings: [] } }]);
  });

  it("drops a failed construction and retries the next DLP check", async () => {
    constructClient.mockImplementationOnce(() => {
      throw new Error("constructor failed");
    });
    const transport = AppPiiRedactionTransport.create(
      resolveTracePrivacyRuntimeConfig({
        googleApplicationCredentials: JSON.stringify({ project_id: "test-project" }),
      }),
    );

    await expect(
      transport.clearGoogleDlp({ text: "first", piiRedactionLevel: "STRICT" }),
    ).rejects.toThrow("constructor failed");
    await transport.clearGoogleDlp({ text: "second", piiRedactionLevel: "STRICT" });

    expect(constructClient).toHaveBeenCalledTimes(2);
  });

  it("closes the instantiated DLP client", async () => {
    const transport = AppPiiRedactionTransport.create(
      resolveTracePrivacyRuntimeConfig({
        googleApplicationCredentials: JSON.stringify({ project_id: "test-project" }),
      }),
    );
    await transport.clearGoogleDlp({ text: "value", piiRedactionLevel: "STRICT" });
    await transport.close();

    expect(closeMock).toHaveBeenCalledOnce();
  });

  it("keeps the legacy unavailable-credentials error at DLP use after parse-once rejection", async () => {
    const transport = AppPiiRedactionTransport.create(
      resolveTracePrivacyRuntimeConfig({ googleApplicationCredentials: "{invalid" }),
    );

    await expect(
      transport.clearGoogleDlp({ text: "value", piiRedactionLevel: "STRICT" }),
    ).rejects.toThrow("GOOGLE_APPLICATION_CREDENTIALS is not configured");
  });

  describe("given no DLP client has been created yet", () => {
    describe("when several checks start before the SDK import settles", () => {
      it("creates exactly one client for all of them", async () => {
        // Started without awaiting in between, so every call reaches the client
        // getter while the dynamic import of the SDK is still pending.
        const transport = AppPiiRedactionTransport.create(
          resolveTracePrivacyRuntimeConfig({
            googleApplicationCredentials: JSON.stringify({
              project_id: "test-project",
              client_email: "test@example.test",
              private_key: "private-key",
              workforce_pool_user_project: "extra-auth-field",
            }),
          }),
        );
        const checks = Array.from({ length: 5 }, (_, index) =>
          transport.clearGoogleDlp({
            text: `subject ${index}`,
            piiRedactionLevel: "STRICT",
          }),
        );

        await Promise.all(checks);

        expect(constructClient).toHaveBeenCalledTimes(1);
        expect(constructClient).toHaveBeenCalledWith(
          expect.objectContaining({
            credentials: expect.objectContaining({
              workforce_pool_user_project: "extra-auth-field",
            }),
          }),
        );
        expect(inspectContentMock).toHaveBeenCalledTimes(5);
      });
    });
  });
});
