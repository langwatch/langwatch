/**
 * The oversized-payload round trip, end to end over everything but AWS.
 *
 *   [NlpInvokeTransportAdapter — the real staging decision]
 *     │ envelope past the threshold, so the body is parked and the
 *     │ X-Payload-S3-URL header replaces it
 *     ▼
 *   [fake object store on loopback — an in-memory driver behind the port]
 *     │
 *     │ [fake Lambda transport: the envelope becomes an HTTP request]
 *     ▼
 *   [real nlpgo subprocess]
 *     │ readStudioRequestBody sees the header and GETs the parked body
 *     ▼
 *   [engine executes the workflow and answers with the full input]
 *
 * The two hops this does NOT exercise are AWS's: the Lambda transport and S3's
 * own storage. What our code decides — the staging threshold, the header, the
 * URL it emits, the discard afterwards — runs here for real.
 *
 * The engine's guard admits the loopback origin only because
 * `NLPGO_TEST_ONLY_STAGED_PAYLOAD_ORIGIN` names that exact origin, and a
 * deployed environment ignores the variable outright.
 *
 * @see specs/nlp-go/lambda-invoke-payload-staging.feature
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  NlpInvokeTransportAdapter,
  NlpLambdaInvoke,
  type NlpLambdaInvokeResult,
  NlpPayloadStaging,
  type StagedNlpPayload,
} from "@langwatch/workflow-server/testing";

import { hasGo, type NlpgoSubprocess, startNlpgoSubprocess } from "../nlpgo-subprocess.ts";

// Unique port alongside the other nlpgo subprocess integration tests
// (55610 / 55611 / 55612 / 55613 / 55614 / 55620 — see CLAUDE.md). 55615 is
// this one's.
const NLPGO_PORT = 55615;

/** Past the 6 MiB (6291456 byte) synchronous-invoke cap the staging exists for. */
const OVERSIZED_INPUT_BYTES = 7 * 1024 * 1024;

/** A fake ARN: the transport branches on the prefix, never on the rest. */
const LAMBDA_ARN = "arn:aws:lambda:eu-central-1:000000000000:function:nlpgo-test";

const PROJECT_ID = "project_staging_roundtrip";
const TRACE_ID = "stage0123456789abstage0123456789";

/**
 * The parked bodies, served over loopback.
 *
 * The in-memory driver the staging port writes through: bytes under a key,
 * served at a URL, which is all the engine needs from an object store. The
 * presign is not modelled — the engine never checks one.
 */
class FakeObjectStore {
  private readonly objects = new Map<string, Buffer>();
  private server: Server | undefined;
  private origin = "";

  async start(): Promise<string> {
    const server = createServer((request, response) => {
      const key = decodeURIComponent(new URL(request.url ?? "/", this.origin).pathname.slice(1));
      const body = this.objects.get(key);
      if (!body) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json" }).end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    this.server = server;
    this.origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return this.origin;
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }

  put(key: string, body: Buffer): string {
    this.objects.set(key, body);
    return `${this.origin}/${encodeURIComponent(key)}`;
  }

  delete(key: string): void {
    this.objects.delete(key);
  }

  get size(): number {
    return this.objects.size;
  }
}

/** The staging port over the store above — the driver, not the decision. */
class InMemoryPayloadStaging extends NlpPayloadStaging {
  constructor(private readonly store: FakeObjectStore) {
    super();
  }

  stage(input: {
    projectId: string;
    keyPrefix: string;
    serialized: Buffer;
    ttlSeconds: number;
  }): Promise<StagedNlpPayload> {
    const key = `${input.keyPrefix}/body.json`;
    const url = this.store.put(key, input.serialized);
    return Promise.resolve({ url, discard: () => Promise.resolve(this.store.delete(key)) });
  }
}

/**
 * The one hop AWS owns, faked: it takes the invoke Payload the transport built
 * and replays it at the live engine as the HTTP request Lambda would have.
 */
class HttpLambdaTransport extends NlpLambdaInvoke {
  /** Every payload as invoked, so the test can assert what went over the wire. */
  readonly payloads: string[] = [];

  constructor(private readonly baseUrl: string) {
    super();
  }

  async invoke(input: { functionArn: string; payload: string }): Promise<NlpLambdaInvokeResult> {
    this.payloads.push(input.payload);
    const envelope = JSON.parse(input.payload) as {
      rawPath: string;
      requestContext: { http: { method: string } };
      headers: Record<string, string>;
      body?: string;
    };
    const response = await fetch(`${this.baseUrl}${envelope.rawPath}`, {
      method: envelope.requestContext.http.method,
      headers: envelope.headers,
      body: envelope.body ?? "",
    });
    return { statusCode: response.status, payload: await response.text() };
  }
}

/** Entry to end, so the engine needs no model provider to answer. */
const executeFlowBody = (input: string): string =>
  JSON.stringify({
    type: "execute_flow",
    payload: {
      trace_id: TRACE_ID,
      project_id: PROJECT_ID,
      origin: "workflow",
      workflow: {
        workflow_id: "wf_staging_roundtrip",
        api_key: "test-key-staging-roundtrip",
        spec_version: "1.3",
        name: "Staging round trip",
        icon: "x",
        description: "x",
        version: "x",
        template_adapter: "default",
        nodes: [
          { id: "entry", type: "entry", data: { outputs: [{ identifier: "input", type: "str" }] } },
          { id: "end", type: "end", data: {} },
        ],
        edges: [
          {
            id: "e1",
            source: "entry",
            sourceHandle: "outputs.input",
            target: "end",
            targetHandle: "inputs.output",
            type: "default",
          },
        ],
        state: {},
      },
      inputs: { input },
      manual_execution_mode: false,
      do_not_trace: true,
    },
  });

describe.skipIf(!hasGo())("the oversized nlpgo invoke round trip", () => {
  const store = new FakeObjectStore();
  let nlpgo: NlpgoSubprocess;
  let lambda: HttpLambdaTransport;
  let transport: NlpInvokeTransportAdapter;

  beforeAll(async () => {
    const origin = await store.start();
    nlpgo = await startNlpgoSubprocess({
      port: NLPGO_PORT,
      env: { ENVIRONMENT: "test", NLPGO_TEST_ONLY_STAGED_PAYLOAD_ORIGIN: origin },
    });
    lambda = new HttpLambdaTransport(nlpgo.baseUrl);
    transport = NlpInvokeTransportAdapter.create({
      target: LAMBDA_ARN,
      config: {
        stagingThresholdBytes: 5 * 1024 * 1024,
        stagingTtlSeconds: 600,
        maxPayloadBytes: 64 * 1024 * 1024,
      },
      lambda,
      staging: new InMemoryPayloadStaging(store),
    });
  }, 700_000);

  afterAll(async () => {
    await nlpgo?.stop();
    await store.stop();
  });

  describe("given a workflow invoke body larger than the 6 MiB Lambda cap", () => {
    describe("when the control plane stages it and the engine fetches it back", () => {
      /** @scenario "A real oversized payload round-trips through S3 to the live engine" */
      it("executes the full body and leaves no staged object behind", async () => {
        const input = `head-${"x".repeat(OVERSIZED_INPUT_BYTES)}-tail`;
        const body = executeFlowBody(input);
        expect(Buffer.byteLength(body, "utf-8")).toBeGreaterThan(6_291_456);

        const response = await transport.send({
          path: "/go/studio/execute_sync",
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          projectId: PROJECT_ID,
        });

        expect(response.ok, `engine answered ${response.status} ${response.statusText}`).toBe(true);

        // The engine received the WHOLE body: the end node echoes the entry's
        // input, so a truncated fetch would come back short.
        const result = (await response.json()) as {
          trace_id: string;
          result?: Record<string, unknown>;
        };
        expect(result.trace_id).toBe(TRACE_ID);
        expect(JSON.stringify(result.result ?? {})).toContain(`head-${"x".repeat(64)}`);
        expect(JSON.stringify(result.result ?? {})).toContain(`${"x".repeat(64)}-tail`);

        // What went over the invoke is the header, not the body — the cap the
        // whole mechanism exists for.
        const [payload] = lambda.payloads;
        expect(payload).toBeDefined();
        expect(Buffer.byteLength(payload ?? "", "utf-8")).toBeLessThan(6_291_456);
        expect(payload).toContain("X-Payload-S3-URL");

        // And the parked object is gone once the invoke settled.
        expect(store.size).toBe(0);
      }, 120_000);
    });
  });
});
