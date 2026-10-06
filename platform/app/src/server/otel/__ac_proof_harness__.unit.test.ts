/**
 * TEMPORARY USER-TEST HARNESS (issue #8494) — untracked, deleted after the run.
 *
 * Boots the REAL `~/server/routes/otel` Hono app on a TCP port via
 * @hono/node-server and drives it with REAL `curl` subprocesses carrying REAL
 * OTLP protobuf bodies compressed with REAL tools. Only auth / app-layer /
 * prisma / ee-governance / posthog are stubbed; the decompression +
 * magic-byte-sniff + parse + error-mapping path is entirely real code.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { gzipSync, zstdCompressSync, deflateSync } from "node:zlib";
import { serve } from "@hono/node-server";
import * as root from "@opentelemetry/otlp-transformer/build/src/generated/root";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

// ── stubs: everything that is NOT the body-reader / parser / error mapper ──

const handleOtlpTraceRequest = vi.fn(async (_projectId: string, req: any) => {
  const spans = (req.resourceSpans ?? []).flatMap((rs: any) =>
    (rs.scopeSpans ?? []).flatMap((ss: any) => ss.spans ?? []),
  );
  // Surface what actually reached the downstream handler.
  const names = spans.map((s: any) => s.name);
  process.stdout.write(
    `\n[DOWNSTREAM] handleOtlpTraceRequest reached: spanCount=${spans.length} names=${JSON.stringify(names)}\n`,
  );
  return { rejectedSpans: 0, errorMessage: "" };
});

const fakeApp = {
  usage: { checkLimit: vi.fn(async () => ({ exceeded: false })) },
  traces: { collection: { handleOtlpTraceRequest } },
};

vi.mock("~/server/db", () => ({ prisma: {} }));
vi.mock("~/utils/posthogErrorCapture", () => ({ captureException: vi.fn() }));
vi.mock("~/server/app-layer/app", () => ({
  getApp: () => fakeApp,
  tryGetApp: () => undefined, // appContextMiddleware tolerates absence
}));
vi.mock("~/server/api-key/token-resolver", () => ({
  TokenResolver: {
    create: () => ({
      resolve: async () => ({
        type: "apiKey",
        apiKeyId: "key_test",
        organizationId: "org_test",
        ingestSourceType: null,
        ingestionTemplateId: null,
        project: {
          id: "proj_test",
          teamId: "team_test",
          team: { organizationId: "org_test" },
        },
      }),
      markUsed: vi.fn(),
    }),
  },
}));
vi.mock("~/server/api-key/auth-middleware", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    collectAuthDiagnostics: () => ({}),
    extractCredentials: (getHeader: (n: string) => string | undefined) => {
      const tok = getHeader("x-auth-token") ?? getHeader("authorization");
      return tok ? { token: "sk-lw-test", projectId: undefined } : null;
    },
    enforceApiKeyCeiling: async () => {},
    apiKeyCeilingDenialResponse: () => ({
      status: 403,
      message: "denied",
      body: { message: "denied" },
    }),
  };
});
vi.mock("@ee/governance/services/costAttributionPolicy.service", () => ({
  resolveSourceNonBillable: async () => false,
}));
vi.mock("@ee/governance/services/ingestKeyProvenance.utils", () => ({
  dropForeignScopesForVscodeKey: () => 0,
  enforceApiKeyIdOnTraceRequest: () => {},
  enforceApiKeyIdOnLogRequest: () => {},
  enforceApiKeyIdOnMetricRequest: () => {},
  stampIngestKeyProvenanceOnTraceRequest: () => {},
  stampIngestKeyProvenanceOnLogRequest: () => {},
  stampIngestKeyProvenanceOnMetricRequest: () => {},
}));
vi.mock("langwatch", () => ({
  getLangWatchTracer: () => ({
    withActiveSpan: async (_n: string, _o: any, fn: any) =>
      fn({ setStatus() {}, setAttribute() {}, setAttributes() {} }),
  }),
}));

const traceRequestType = (root as any).opentelemetry.proto.collector.trace.v1
  .ExportTraceServiceRequest;

function buildTraceProtobuf(spanName = "ac-proof-span"): Buffer {
  const payload = {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: "ac-proof" } },
          ],
        },
        scopeSpans: [
          {
            scope: { name: "ac-proof-scope", version: "1.0.0" },
            spans: [
              {
                traceId: "0123456789abcdef0123456789abcdef",
                spanId: "0123456789abcdef",
                name: spanName,
                kind: 1,
                startTimeUnixNano: "1700000000000000000",
                endTimeUnixNano: "1700000000100000000",
                status: { code: 1 },
              },
            ],
          },
        ],
      },
    ],
  };
  const msg = traceRequestType.create(payload);
  const bytes = traceRequestType.encode(msg).finish() as Uint8Array;
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

const DIR =
  "/tmp/claude-1001/-home-ubuntu-worktrees-langwatch-issue8494/e883177b-e9d1-49be-9275-607b44dc62a3/scratchpad/proof";

let server: ReturnType<typeof serve>;
let base: string;

beforeAll(async () => {
  const otel = await import("~/server/routes/otel");
  const app = (otel as any).app;
  await new Promise<void>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0 }, (info: any) => {
      base = `http://127.0.0.1:${info.port}`;
      process.stdout.write(`\n[SERVER] real otel app listening on ${base}\n`);
      resolve();
    });
  });
});

afterAll(() => {
  server?.close();
});

function curl(args: string[]): string {
  try {
    return execFileSync("curl", ["-s", "-i", ...args], {
      encoding: "utf-8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e: any) {
    return (e.stdout ?? "") + (e.stderr ?? "");
  }
}

function banner(title: string) {
  process.stdout.write(`\n\n========== ${title} ==========\n`);
}

const URL = () => `${base}/api/otel/v1/traces`;
const AUTH = ["-H", "X-Auth-Token: sk-lw-test"];
const PB = ["-H", "Content-Type: application/x-protobuf"];

it("AC1: zstd body, NO Content-Encoding → parses (sniffed)", () => {
  const pb = buildTraceProtobuf("zstd-no-header");
  const f = `${DIR}/ac1.zstd`;
  // real zstd CLI
  writeFileSync(`${DIR}/ac1.pb`, pb);
  execFileSync("zstd", ["-q", "-f", `${DIR}/ac1.pb`, "-o", f]);
  banner("AC1  zstd body, no Content-Encoding header");
  const out = curl([...AUTH, ...PB, "--data-binary", `@${f}`, URL()]);
  process.stdout.write(out + "\n");
  expect(out).toMatch(/HTTP\/1\.1 200/);
});

it("AC2a: gzip body with WRONG Content-Encoding: deflate → parses (sniffed gzip wins)", () => {
  const pb = buildTraceProtobuf("gzip-labeled-deflate");
  const f = `${DIR}/ac2a.gz`;
  execFileSync("bash", ["-c", `printf '%s' x`]); // noop to keep shape
  writeFileSync(f, gzipSync(pb));
  banner("AC2a  gzip body mislabeled Content-Encoding: deflate");
  const out = curl([
    ...AUTH,
    ...PB,
    "-H",
    "Content-Encoding: deflate",
    "--data-binary",
    `@${f}`,
    URL(),
  ]);
  process.stdout.write(out + "\n");
  expect(out).toMatch(/HTTP\/1\.1 200/);
});

it("AC2b: gzip body with unsupported Content-Encoding: snappy → parses (sniffed gzip wins)", () => {
  const pb = buildTraceProtobuf("gzip-labeled-snappy");
  const f = `${DIR}/ac2b.gz`;
  writeFileSync(f, gzipSync(pb));
  banner("AC2b  gzip body mislabeled Content-Encoding: snappy");
  const out = curl([
    ...AUTH,
    ...PB,
    "-H",
    "Content-Encoding: snappy",
    "--data-binary",
    `@${f}`,
    URL(),
  ]);
  process.stdout.write(out + "\n");
  expect(out).toMatch(/HTTP\/1\.1 200/);
});

const BOMB_BYTES = 10 * 1024 * 1024 + 1024; // > OTLP_MAX_BODY_BYTES decompressed

it("AC3a: gzip decompression bomb (>10MiB decompressed, tiny on wire) → 413", () => {
  const f = `${DIR}/bomb.gz`;
  writeFileSync(f, gzipSync(Buffer.alloc(BOMB_BYTES, 0)));
  banner("AC3a  gzip bomb, Content-Encoding: gzip");
  const out = curl([
    ...AUTH,
    ...PB,
    "-H",
    "Content-Encoding: gzip",
    "--data-binary",
    `@${f}`,
    URL(),
  ]);
  process.stdout.write(out.slice(0, 1500) + "\n");
  expect(out).toMatch(/HTTP\/1\.1 413/);
});

it("AC3b: deflate bomb → 413", () => {
  const f = `${DIR}/bomb.deflate`;
  writeFileSync(f, deflateSync(Buffer.alloc(BOMB_BYTES, 0)));
  banner("AC3b  deflate bomb, Content-Encoding: deflate");
  const out = curl([
    ...AUTH,
    ...PB,
    "-H",
    "Content-Encoding: deflate",
    "--data-binary",
    `@${f}`,
    URL(),
  ]);
  process.stdout.write(out.slice(0, 1500) + "\n");
  expect(out).toMatch(/HTTP\/1\.1 413/);
});

it("AC3c: brotli bomb → 413", () => {
  const { brotliCompressSync } = require("node:zlib");
  const f = `${DIR}/bomb.br`;
  writeFileSync(f, brotliCompressSync(Buffer.alloc(BOMB_BYTES, 0)));
  banner("AC3c  brotli bomb, Content-Encoding: br");
  const out = curl([
    ...AUTH,
    ...PB,
    "-H",
    "Content-Encoding: br",
    "--data-binary",
    `@${f}`,
    URL(),
  ]);
  process.stdout.write(out.slice(0, 1500) + "\n");
  expect(out).toMatch(/HTTP\/1\.1 413/);
});

it("AC3d: zstd bomb with Content-Encoding: zstd → 413", () => {
  const f = `${DIR}/bomb.zst.hdr`;
  writeFileSync(f, zstdCompressSync(Buffer.alloc(BOMB_BYTES, 0)));
  banner("AC3d  zstd bomb, Content-Encoding: zstd");
  const out = curl([
    ...AUTH,
    ...PB,
    "-H",
    "Content-Encoding: zstd",
    "--data-binary",
    `@${f}`,
    URL(),
  ]);
  process.stdout.write(out.slice(0, 1500) + "\n");
  expect(out).toMatch(/HTTP\/1\.1 413/);
});

it("AC3e: zstd bomb SNIFFED (no Content-Encoding) → 413", () => {
  const f = `${DIR}/bomb.zst.sniff`;
  writeFileSync(f, zstdCompressSync(Buffer.alloc(BOMB_BYTES, 0)));
  banner("AC3e  zstd bomb, NO Content-Encoding (sniffed)");
  const out = curl([...AUTH, ...PB, "--data-binary", `@${f}`, URL()]);
  process.stdout.write(out.slice(0, 1500) + "\n");
  expect(out).toMatch(/HTTP\/1\.1 413/);
});

it("REG1: plain uncompressed protobuf, no encoding header → 200", () => {
  const pb = buildTraceProtobuf("plain-identity");
  const f = `${DIR}/reg1.pb`;
  writeFileSync(f, pb);
  banner("REG1  plain uncompressed protobuf, no Content-Encoding");
  const out = curl([...AUTH, ...PB, "--data-binary", `@${f}`, URL()]);
  process.stdout.write(out + "\n");
  expect(out).toMatch(/HTTP\/1\.1 200/);
});

it("REG2: non-compressed body under Content-Encoding: snappy → 400", () => {
  const pb = buildTraceProtobuf("snappy-uncompressed");
  const f = `${DIR}/reg2.pb`;
  writeFileSync(f, pb); // NOT compressed; snappy is unsupported + unsniffable
  banner("REG2  uncompressed body, Content-Encoding: snappy (unsupported)");
  const out = curl([
    ...AUTH,
    ...PB,
    "-H",
    "Content-Encoding: snappy",
    "--data-binary",
    `@${f}`,
    URL(),
  ]);
  process.stdout.write(out + "\n");
  expect(out).toMatch(/HTTP\/1\.1 400/);
});
