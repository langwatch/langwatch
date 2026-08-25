import { describe, expect, it, vi } from "vitest";
import { HttpPollingPullerAdapter } from "../src/adapters/http-poller.http-poller.adapter";
import { S3PollingPullerAdapter } from "../src/adapters/s3-puller.s3-puller.adapter";
import {
  GovernanceHttpPort,
  type GovernanceHttpResponse,
} from "../src/ports/governance-http.port";
import { GovernanceObjectStoragePort } from "../src/ports/governance-object-storage.port";

class FakeHttp extends GovernanceHttpPort {
  readonly calls: Array<{ url: string; headers?: Record<string, string> }> = [];
  responses: unknown[] = [];

  async fetch(
    url: string,
    init: { headers?: Record<string, string> },
  ): Promise<GovernanceHttpResponse> {
    this.calls.push({ url, headers: init.headers });
    const body = this.responses.shift();
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  }
}

class FakeObjects extends GovernanceObjectStoragePort {
  list = vi.fn(async () => ["logs/001.ndjson"]);
  readText = vi.fn(async () =>
    JSON.stringify({
      id: "event-1",
      at: "2026-08-24T09:00:00.000Z",
      actor: "alex@example.com",
      action: "invoke",
      target: "model",
    }),
  );
}

describe("governance puller adapters", () => {
  it("templates HTTP credentials at the injected SSRF boundary and resumes", async () => {
    const http = new FakeHttp();
    http.responses.push(
      {
        events: [
          {
            id: "event-1",
            at: "2026-08-24T09:00:00.000Z",
            actor: "alex@example.com",
            action: "invoke",
            target: "model",
          },
        ],
        next: "page-2",
      },
      { events: [], next: null },
    );
    const puller = HttpPollingPullerAdapter.create({ http });
    const config = puller.validateConfig({
      adapter: "http_polling",
      url: "https://audit.example.test/events",
      method: "GET",
      headers: { "x-api-key": "${{credentials.token}}" },
      authMode: "header_template",
      cursorJsonPath: "$.next",
      cursorQueryParam: "cursor",
      eventsJsonPath: "$.events",
      schedule: "* * * * *",
      eventMapping: {
        source_event_id: "$.id",
        event_timestamp: "$.at",
        actor: "$.actor",
        action: "$.action",
        target: "$.target",
      },
    });

    const result = await puller.runOnce(
      { cursor: null, credentials: { token: "secret" } },
      config,
    );

    expect(result.events).toHaveLength(1);
    expect(result.cursor).toBeNull();
    expect(http.calls[0]?.headers).toMatchObject({ "x-api-key": "secret" });
    expect(http.calls[1]?.url).toContain("cursor=page-2");
  });

  it("passes S3 credentials and byte caps only to the injected object port", async () => {
    const objects = new FakeObjects();
    const puller = S3PollingPullerAdapter.create({ objects });
    const config = puller.validateConfig({
      adapter: "s3_polling",
      bucket: "audit-bucket",
      prefix: "logs/",
      region: "eu-west-1",
      parser: "ndjson",
      schedule: "* * * * *",
      eventMapping: {
        source_event_id: "$.id",
        event_timestamp: "$.at",
        actor: "$.actor",
        action: "$.action",
        target: "$.target",
      },
    });

    const result = await puller.runOnce(
      {
        cursor: null,
        credentials: {
          aws_access_key_id: "access",
          aws_secret_access_key: "secret",
        },
      },
      config,
    );

    expect(result).toMatchObject({ cursor: "logs/001.ndjson", errorCount: 0 });
    expect(objects.readText).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: "audit-bucket",
        maxBytes: 50 * 1024 * 1024,
        credentials: {
          accessKeyId: "access",
          secretAccessKey: "secret",
        },
      }),
    );
  });
});
