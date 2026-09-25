/**
 * @vitest-environment node
 * The logs door mounted on the real REST host: which exporter paths reach the
 * receiver, and the wire each outcome is written in.
 */
import { createApiFixture } from "@langwatch/api-fixture";
import { RestHost } from "@langwatch/api/rest";
import type { LogApi } from "@langwatch/log-contract";
import type { OtlpDoorRequest } from "@langwatch/otlp";
import { describe, expect, it } from "vitest";

import { otlpLogsRest } from "../otlp-logs.rest.ts";

function mountedDoor() {
  const received: OtlpDoorRequest[] = [];
  const app = createApiFixture<LogApi>({
    receiveOtlpLogs: async (request) => {
      received.push(request);
      return request.path.endsWith("/")
        ? { outcome: "parse-failed" }
        : { outcome: "collected", acceptedLogRecords: 1, rejectedLogRecords: 0 };
    },
  });
  const closed = {
    authenticate: () => {
      throw new Error("the logs door resolves its key itself.");
    },
  };
  const host = RestHost.create({
    identities: {
      project: closed,
      organization: closed,
      apiKey: closed,
      scimToken: closed,
      "instance-admin": closed,
      browser: closed,
    },
    bearers: () => closed,
    audit: { record: async () => {} },
  });
  host.mount(otlpLogsRest.router(), () => app);
  const post = (path: string) =>
    host.app.fetch(
      new Request(`http://api.test${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-auth-token": "sk-lw-test" },
        body: "{}",
      }),
    );
  return { post, received };
}

describe("the OTLP logs door", () => {
  describe("given an exporter posts to main's canonical path or one of its aliases", () => {
    it.each([
      "/api/otel/v1/logs",
      "/api/otel/v1/traces/v1/logs",
      "/api/collector/v1/logs",
      "/api/v1/logs",
      "/v1/logs",
    ])("hands %s to the receiver and answers 200 {}", async (path) => {
      const { post, received } = mountedDoor();

      const response = await post(path);

      expect([response.status, await response.json()]).toEqual([200, {}]);
      expect(received.map((request) => [request.path, request.headers["x-auth-token"]])).toEqual([
        [path, "sk-lw-test"],
      ]);
    });

    it.each(["/api/otel/v1/logs/", "/v1/logs/"])(
      "reaches the receiver with a trailing slash at %s",
      async (path) => {
        const { post, received } = mountedDoor();

        const response = await post(path);

        expect([response.status, await response.json()]).toEqual([
          400,
          { error: "Failed to parse logs" },
        ]);
        expect(received).toHaveLength(1);
      },
    );
  });
});
