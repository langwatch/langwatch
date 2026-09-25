import { describe, expect, it, vi } from "vitest";

import type { PiiAnalysisMetrics } from "../../../app/data-privacy.members.ts";
import { GoogleDlpRedactionService } from "../../../services/google-dlp-redaction.service.ts";
import { HttpGoogleDlpChannel } from "../http.google-dlp.channel.ts";

/** Counters, not spies: the package clears mocks per test, which would hide a load at import. */
const { sdk, inspectContent } = vi.hoisted(() => ({
  sdk: { loads: 0, clients: 0 },
  inspectContent: vi.fn(),
}));

vi.mock("@google-cloud/dlp", () => {
  sdk.loads += 1;
  return {
    DlpServiceClient: class {
      constructor() {
        sdk.clients += 1;
      }
      inspectContent = inspectContent;
      close = vi.fn();
    },
  };
});

const credential = JSON.stringify({ project_id: "test-project" });

class SilentMetrics implements PiiAnalysisMetrics {
  analysisCalled(): void {}
  analysisObserved(): void {}
  analysisFinished(): void {}
}

describe("HttpGoogleDlpChannel", () => {
  describe("given DLP is opted out while credentials are present", () => {
    /** @scenario "Google DLP loads its cloud SDK only when enabled and used" */
    it("never loads the SDK, at construction or when a check is refused", async () => {
      const service = GoogleDlpRedactionService.create({
        dlp: HttpGoogleDlpChannel.create({ credential }),
        disabled: true,
        metrics: new SilentMetrics(),
      });

      await expect(
        service.clear({ text: "call me at 555-123-4567", piiRedactionLevel: "STRICT" }),
      ).rejects.toThrow("LANGWATCH_DISABLE_GOOGLE_DLP");
      expect(sdk).toEqual({ loads: 0, clients: 0 });
      expect(inspectContent).not.toHaveBeenCalled();
    });
  });

  describe("given a credentialed channel", () => {
    /** @scenario "Google DLP loads its cloud SDK only when enabled and used" */
    it("opens one client on first inspection, shared by concurrent inspections", async () => {
      inspectContent.mockResolvedValue([{ result: { findings: [] } }]);
      const channel = HttpGoogleDlpChannel.create({ credential });
      expect(sdk.loads).toBe(0);

      await Promise.all([
        channel.inspect({ text: "a", infoTypes: ["EMAIL_ADDRESS"] }),
        channel.inspect({ text: "b", infoTypes: ["EMAIL_ADDRESS"] }),
      ]);

      expect(sdk).toEqual({ loads: 1, clients: 1 });
      expect(inspectContent).toHaveBeenCalledTimes(2);
      await channel.close();
    });
  });
});
