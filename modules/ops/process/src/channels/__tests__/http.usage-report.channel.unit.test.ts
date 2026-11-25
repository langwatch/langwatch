import { describe, expect, it, vi } from "vitest";

import {
  HttpUsageReportChannel,
  type UsageReportFetch,
} from "../http/http.usage-report.channel.ts";

function requestBody(init: RequestInit | undefined): string {
  const body = init?.body;
  if (body instanceof URLSearchParams) return body.toString();
  if (typeof body !== "string") throw new Error("expected a string request body");
  return body;
}

const WELL_FORMED_NOTICE = {
  id: "n1",
  severity: "security",
  title: "Vulnerability in prompt sharing",
  body: "Upgrade to 3.4.2.",
  url: "https://langwatch.ai/security/n1",
  fixed_in: "3.4.2",
  published_at: "2026-10-20T09:00:00.000Z",
};

describe("HttpUsageReportChannel", () => {
  describe("when a host answers", () => {
    it("posts the report as JSON and resolves with the status, whatever it was", async () => {
      const send = vi.fn<UsageReportFetch>(async () => ({
        status: 413,
        json: async () => ({ message: "too large" }),
      }));
      const channel = HttpUsageReportChannel.create({ fetch: send });

      const answer = await channel.post({
        endpoint: "https://app.langwatch.ai/api/track_usage",
        body: { event: "daily_usage_stats", instance_id: "4b1c" },
      });

      expect(answer).toEqual({ status: 413, latestRelease: null, notices: [] });
      const [url, init] = send.mock.calls[0] ?? [];
      expect(url).toBe("https://app.langwatch.ai/api/track_usage");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(requestBody(init))).toEqual({
        event: "daily_usage_stats",
        instance_id: "4b1c",
      });
    });
  });

  describe("when cloud's reply names a latest release", () => {
    /** @scenario "The usage report keeps the latest release cloud's reply names" */
    it("reads the release and its commit from the reply", async () => {
      const channel = HttpUsageReportChannel.create({
        fetch: async () => ({
          status: 200,
          json: async () => ({
            message: "Event captured",
            latest_release: { release: "3.22.0", commit: "def5678" },
          }),
        }),
      });

      const answer = await channel.post({ endpoint: "https://app.langwatch.ai", body: {} });

      expect(answer.latestRelease).toEqual({ release: "3.22.0", commit: "def5678" });
    });
  });

  describe("when cloud's reply names a malformed notice beside a well-formed one", () => {
    /** @scenario "A malformed notice is dropped and the rest are kept" */
    it("keeps only the well-formed notice and still reads the latest release", async () => {
      const channel = HttpUsageReportChannel.create({
        fetch: async () => ({
          status: 200,
          json: async () => ({
            latest_release: { release: "3.22.0", commit: null },
            notices: [WELL_FORMED_NOTICE, { ...WELL_FORMED_NOTICE, id: "n2", title: undefined }],
          }),
        }),
      });

      const answer = await channel.post({ endpoint: "https://app.langwatch.ai", body: {} });

      expect(answer.notices).toEqual([WELL_FORMED_NOTICE]);
      expect(answer.latestRelease).toEqual({ release: "3.22.0", commit: null });
    });

    it("keeps the latest release when the notices are not a list", async () => {
      const channel = HttpUsageReportChannel.create({
        fetch: async () => ({
          status: 200,
          json: async () => ({ latest_release: { release: "3.22.0" }, notices: "broken" }),
        }),
      });

      const answer = await channel.post({ endpoint: "https://app.langwatch.ai", body: {} });

      expect(answer).toEqual({
        status: 200,
        latestRelease: { release: "3.22.0", commit: null },
        notices: [],
      });
    });
  });

  describe("when no host answers", () => {
    it("throws, so the sender can name the report unreachable", async () => {
      const channel = HttpUsageReportChannel.create({
        fetch: async () => {
          throw new TypeError("fetch failed");
        },
      });

      await expect(
        channel.post({ endpoint: "https://app.langwatch.ai/api/track_usage", body: {} }),
      ).rejects.toThrow("fetch failed");
    });
  });
});
