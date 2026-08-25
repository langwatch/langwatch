import { describe, expect, it, vi } from "vitest";

import { HttpPollingPullerAdapter } from "../src/adapters/http-poller.http-poller.adapter";
import { S3PollingPullerAdapter } from "../src/adapters/s3-puller.s3-puller.adapter";
import {
  GovernanceHttpPort,
  type GovernanceHttpResponse,
} from "../src/ports/governance-http.port";
import { GovernanceObjectStoragePort } from "../src/ports/governance-object-storage.port";

const httpConfig = {
  adapter: "http_polling",
  url: "https://audit.example.test/events",
  headers: {
    Authorization: "Bearer ${{credentials.token}}",
    "X-Organisation": "${{ingestionSource.organizationId}}",
  },
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
    cost_usd: "$.cost",
    tokens_input: "$.input",
    tokens_output: "$.output",
  },
};

const s3Config = {
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
    cost_usd: "$.cost",
    tokens_input: "$.input",
    tokens_output: "$.output",
  },
};

function response(status: number, body: unknown): GovernanceHttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "failed",
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function event(id: string) {
  return {
    id,
    at: "2026-08-24T09:00:00.000Z",
    actor: `${id}@example.test`,
    action: "invoke",
    target: "model",
    cost: "0.0001",
    input: 1,
    output: 2,
  };
}

class FakeHttp extends GovernanceHttpPort {
  readonly calls: Array<{
    url: string;
    init: Parameters<GovernanceHttpPort["fetch"]>[1];
  }> = [];
  readonly responses: Array<GovernanceHttpResponse | Error> = [];

  async fetch(
    url: string,
    init: Parameters<GovernanceHttpPort["fetch"]>[1],
  ): Promise<GovernanceHttpResponse> {
    this.calls.push({ url, init });
    const next = this.responses.shift();
    if (next instanceof Error) throw next;
    if (!next) throw new Error("test did not queue an HTTP response");
    return next;
  }
}

class FakeObjects extends GovernanceObjectStoragePort {
  readonly list = vi.fn(
    async (
      _input: Parameters<GovernanceObjectStoragePort["list"]>[0],
    ): Promise<string[]> => [],
  );
  readonly readText = vi.fn(
    async (_input: Parameters<GovernanceObjectStoragePort["readText"]>[0]) => "",
  );
}

function httpAdapter(http: FakeHttp): HttpPollingPullerAdapter {
  return HttpPollingPullerAdapter.create({ http });
}

function s3Adapter(objects: FakeObjects): S3PollingPullerAdapter {
  return S3PollingPullerAdapter.create({ objects });
}

describe("HTTP polling puller", () => {
  it("validates its boundary and applies the GET default", () => {
    const adapter = httpAdapter(new FakeHttp());
    const withoutMethod = { ...httpConfig };

    expect(adapter.validateConfig(withoutMethod).method).toBe("GET");
    expect(() => adapter.validateConfig({ ...httpConfig, url: "not-a-url" })).toThrow();
    expect(() => adapter.validateConfig({ ...httpConfig, adapter: "other" })).toThrow();
    expect(() =>
      adapter.validateConfig({
        ...httpConfig,
        eventMapping: { ...httpConfig.eventMapping, target: "" },
      }),
    ).toThrow();
  });

  it("maps a drained page and substitutes credentials and source context", async () => {
    const http = new FakeHttp();
    http.responses.push(response(200, { events: [event("one")], next: null }));
    const adapter = httpAdapter(http);

    const result = await adapter.runOnce(
      {
        cursor: null,
        credentials: { token: "secret" },
        context: { organizationId: "org-1", ingestionSourceId: "source-1" },
      },
      adapter.validateConfig(httpConfig),
    );

    expect(result).toMatchObject({ cursor: null, errorCount: 0 });
    expect(result.events[0]).toMatchObject({
      source_event_id: "one",
      cost_usd: "0.0001",
    });
    expect(http.calls[0]?.init.headers).toMatchObject({
      Authorization: "Bearer secret",
      "X-Organisation": "org-1",
    });
  });

  it("follows relative and absolute cursors until a feed drains", async () => {
    const http = new FakeHttp();
    const absolute = "https://graph.example.test/audit?$skiptoken=second";
    http.responses.push(
      response(200, { events: [event("one")], next: "second" }),
      response(200, { events: [event("two")], next: absolute }),
      response(200, { events: [event("three")], next: null }),
    );
    const adapter = httpAdapter(http);

    const result = await adapter.runOnce(
      { cursor: null },
      adapter.validateConfig(httpConfig),
    );

    expect(result.events.map((item) => item.source_event_id)).toEqual([
      "one",
      "two",
      "three",
    ]);
    expect(http.calls[1]?.url).toContain("cursor=second");
    expect(http.calls[2]?.url).toBe(absolute);
  });

  it("holds the original cursor for a 4xx or exhausted retryable failure", async () => {
    const unauthorized = new FakeHttp();
    unauthorized.responses.push(response(401, { error: "nope" }));
    const unavailable = new FakeHttp();
    unavailable.responses.push(response(503, {}), response(503, {}), response(503, {}));
    const config = httpAdapter(unauthorized).validateConfig(httpConfig);

    await expect(
      httpAdapter(unauthorized).runOnce({ cursor: "held" }, config),
    ).resolves.toMatchObject({
      cursor: "held",
      errorCount: 1,
      events: [],
    });
    await expect(
      httpAdapter(unavailable).runOnce({ cursor: "held" }, config),
    ).resolves.toMatchObject({
      cursor: "held",
      errorCount: 1,
    });
    expect(unauthorized.calls).toHaveLength(1);
    expect(unavailable.calls).toHaveLength(3);
  });

  it("treats an absent cursor field as a drained feed", async () => {
    const http = new FakeHttp();
    http.responses.push(response(200, { events: [] }));
    const adapter = httpAdapter(http);

    await expect(
      adapter.runOnce({ cursor: null }, adapter.validateConfig(httpConfig)),
    ).resolves.toMatchObject({
      cursor: null,
      errorCount: 0,
    });
  });
});

describe("S3 polling puller", () => {
  it("validates parser and bucket while defaulting an omitted prefix", () => {
    const adapter = s3Adapter(new FakeObjects());
    const { prefix: _prefix, ...withoutPrefix } = s3Config;

    expect(adapter.validateConfig(withoutPrefix).prefix).toBe("");
    expect(() => adapter.validateConfig({ ...s3Config, parser: "yaml" })).toThrow();
    expect(() => adapter.validateConfig({ ...s3Config, bucket: "" })).toThrow();
  });

  it("reads ordered keys, advances to the final key, and forwards AWS credentials", async () => {
    const objects = new FakeObjects();
    objects.list.mockResolvedValue(["logs/001.ndjson", "logs/002.ndjson"]);
    objects.readText.mockImplementation(async ({ key }: { key: string }) =>
      JSON.stringify(event(key === "logs/001.ndjson" ? "one" : "two")),
    );
    const adapter = s3Adapter(objects);

    const result = await adapter.runOnce(
      {
        cursor: null,
        credentials: { aws_access_key_id: "access", aws_secret_access_key: "secret" },
      },
      adapter.validateConfig(s3Config),
    );

    expect(result.events.map((item) => item.source_event_id)).toEqual(["one", "two"]);
    expect(result.cursor).toBe("logs/002.ndjson");
    expect(objects.list).toHaveBeenCalledWith(
      expect.objectContaining({ prefix: "logs/", startAfter: void 0 }),
    );
    expect(objects.readText).toHaveBeenCalledWith(
      expect.objectContaining({
        maxBytes: 50 * 1024 * 1024,
        credentials: {
          accessKeyId: "access",
          secretAccessKey: "secret",
          sessionToken: void 0,
        },
      }),
    );
  });

  it("uses StartAfter and holds a cursor when there are no later objects", async () => {
    const resumed = new FakeObjects();
    resumed.list.mockResolvedValue(["logs/003.ndjson"]);
    resumed.readText.mockResolvedValue(JSON.stringify(event("three")));
    const adapter = s3Adapter(resumed);

    await expect(
      adapter.runOnce({ cursor: "logs/002.ndjson" }, adapter.validateConfig(s3Config)),
    ).resolves.toMatchObject({ cursor: "logs/003.ndjson" });
    expect(resumed.list).toHaveBeenCalledWith(
      expect.objectContaining({ startAfter: "logs/002.ndjson" }),
    );

    const drained = new FakeObjects();
    const empty = s3Adapter(drained);
    await expect(
      empty.runOnce({ cursor: "logs/003.ndjson" }, empty.validateConfig(s3Config)),
    ).resolves.toMatchObject({ cursor: "logs/003.ndjson", events: [], errorCount: 0 });
  });

  it("progresses past malformed ndjson and object read failures", async () => {
    const objects = new FakeObjects();
    objects.list.mockResolvedValue(["logs/bad.ndjson", "logs/missing.ndjson"]);
    objects.readText
      .mockResolvedValueOnce(
        `${JSON.stringify(event("one"))}\nthis is not json\n${JSON.stringify(event("two"))}`,
      )
      .mockRejectedValueOnce(new Error("missing object"));
    const adapter = s3Adapter(objects);

    const result = await adapter.runOnce(
      { cursor: null },
      adapter.validateConfig(s3Config),
    );

    expect(result.events.map((item) => item.source_event_id)).toEqual(["one", "two"]);
    expect(result.cursor).toBe("logs/missing.ndjson");
    expect(result.errorCount).toBe(1);
  });

  it.each([
    ["json-array", JSON.stringify([event("one"), event("two")]), ["one", "two"]],
    [
      "csv",
      "id,at,actor,action,target,cost,input,output\none,2026-08-24T09:00:00.000Z,one@example.test,invoke,model,0.1,1,2\ntwo,2026-08-24T09:00:00.000Z,two@example.test,invoke,model,0.2,3,4\n",
      ["one", "two"],
    ],
  ])("maps %s input", async (parser, body, ids) => {
    const objects = new FakeObjects();
    objects.list.mockResolvedValue([`logs/events.${parser}`]);
    objects.readText.mockResolvedValue(body);
    const adapter = s3Adapter(objects);

    const result = await adapter.runOnce(
      { cursor: null },
      adapter.validateConfig({ ...s3Config, parser }),
    );

    expect(result.events.map((item) => item.source_event_id)).toEqual(ids);
  });
});
