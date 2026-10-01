import { uiBatchResponse } from "@langwatch/browser-host/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createUiFeatureApiClient } from "../transport.ts";

const SECRET_INPUT = {
  headers: { Authorization: "Bearer sk-header-secret" },
  signingSecret: "whsec_signing_secret",
};

function answering(body: unknown): typeof globalThis.fetch {
  return (async () => uiBatchResponse({ results: [body] })) as typeof globalThis.fetch;
}

function logged(spies: {
  log: { mock: { calls: unknown[][] } };
  error: { mock: { calls: unknown[][] } };
}) {
  return [...spies.log.mock.calls, ...spies.error.mock.calls].map((call) => call.join(" "));
}

function spyOnConsole() {
  return {
    log: vi.spyOn(console, "log").mockImplementation(() => {}),
    error: vi.spyOn(console, "error").mockImplementation(() => {}),
  };
}

describe("given the browser transport logs requests in development", () => {
  afterEach(() => vi.restoreAllMocks());

  describe("when a webhook automation is saved with header values and a signing secret", () => {
    /** @scenario "The development request log never shows what a request carried" */
    it("logs the operation and its duration and nothing it carried", async () => {
      const spies = spyOnConsole();
      const client = createUiFeatureApiClient({
        isDevelopment: true,
        fetch: answering({ result: { data: { token: "whsec_result_secret" } } }),
      });

      await client.mutation("automation.upsert", SECRET_INPUT);

      const lines = logged(spies);
      expect(lines).toHaveLength(2);
      expect(lines[0]).toBe(">> mutation automation.upsert");
      expect(lines[1]).toMatch(/^<< mutation automation\.upsert \d+ms$/);
      const everything = lines.join("\n");
      expect(everything).not.toContain("sk-header-secret");
      expect(everything).not.toContain("whsec_signing_secret");
      expect(everything).not.toContain("whsec_result_secret");
    });

    it("logs a failed request by its status without its message or input", async () => {
      const spies = spyOnConsole();
      const client = createUiFeatureApiClient({
        isDevelopment: true,
        fetch: answering({ error: { message: "rejected", code: -32004, data: {} } }),
      });

      await expect(client.mutation("automation.upsert", SECRET_INPUT)).rejects.toThrow("rejected");

      expect(spies.error.mock.calls).toHaveLength(1);
      const everything = logged(spies).join("\n");
      expect(everything).toMatch(/<< mutation automation\.upsert \d+ms/);
      expect(everything).not.toContain("whsec_signing_secret");
    });
  });

  describe("when the deployment is not in development", () => {
    it("logs nothing", async () => {
      const spies = spyOnConsole();
      const client = createUiFeatureApiClient({
        fetch: answering({ result: { data: "ok" } }),
      });

      await client.mutation("automation.upsert", SECRET_INPUT);

      expect(logged(spies)).toEqual([]);
    });
  });
});
