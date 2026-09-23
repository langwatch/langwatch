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

describe("HttpUsageReportChannel", () => {
  describe("when a host answers", () => {
    it("posts the report as JSON and resolves with the status, whatever it was", async () => {
      const send = vi.fn<UsageReportFetch>(async () => ({ status: 413 }));
      const channel = HttpUsageReportChannel.create({ fetch: send });

      const answer = await channel.post({
        endpoint: "https://app.langwatch.ai/api/track_usage",
        body: { event: "daily_usage_stats", instance_id: "4b1c" },
      });

      expect(answer).toEqual({ status: 413 });
      const [url, init] = send.mock.calls[0] ?? [];
      expect(url).toBe("https://app.langwatch.ai/api/track_usage");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(requestBody(init))).toEqual({
        event: "daily_usage_stats",
        instance_id: "4b1c",
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
