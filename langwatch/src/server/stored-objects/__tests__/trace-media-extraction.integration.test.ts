/**
 * @vitest-environment node
 * @integration
 *
 * Integration tests for edge media extraction on the trace ingestion path
 * (specs/trace-processing/trace-media-blob-extraction.feature).
 *
 * Exercises `maybeExtractSpanMedia` end to end with a REAL
 * StoredObjectsService: LocalFilesystemDriver on a per-test temp dir for the
 * bytes and testcontainers ClickHouse for the stored_objects rows. Only the
 * environment shims (env, logger, tracer, metrics, CH client resolution) are
 * mocked — the extraction, hashing, dedup, storage, and spool composition
 * paths are the production code.
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as clickhouseClientModule from "~/server/clickhouse/clickhouseClient";
import { wrapRawPcmToWav } from "~/shared/audio/pcmToWav";
import type { BlobStore } from "../../app-layer/traces/blob-store.service";
import {
  maybeExtractSpanMedia,
  TRACE_MEDIA_PURPOSE,
} from "../../app-layer/traces/edge-media-extraction";
import { maybeSpool } from "../../app-layer/traces/edge-spool";
import { COMMAND_INLINE_THRESHOLD } from "../../app-layer/traces/lean-for-projection";
import {
  startTestContainers,
  stopTestContainers,
} from "../../event-sourcing/__tests__/integration/testContainers";
import type { RecordSpanCommandData } from "../../event-sourcing/pipelines/trace-processing/schemas/commands";
import type { OtlpSpan } from "../../event-sourcing/pipelines/trace-processing/schemas/otlp";
import { extractInlineMediaFromEvent } from "../content-extractor";
import { LocalFilesystemDriver } from "../local-filesystem-driver";
import { StorageRegistry } from "../storage-registry";
import { StoredObjectsRepository } from "../stored-objects.repository";
import type { MintStorageUri } from "../stored-objects.service";
import { StoredObjectsService } from "../stored-objects.service";
import { mintFileUri } from "../uri";

// ---------------------------------------------------------------------------
// Environment shims (no behavior mocking)
// ---------------------------------------------------------------------------

vi.mock("~/server/clickhouse/clickhouseClient", () => ({
  getClickHouseClientForProject: vi.fn(),
  getSharedClickHouseClient: vi.fn(),
}));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("langwatch", () => ({
  getLangWatchTracer: () => ({
    withActiveSpan: (_name: string, ...args: unknown[]) => {
      const fn = args.length === 1 ? args[0] : args[1];
      const span = { setAttribute: vi.fn() };
      return (fn as (s: typeof span) => Promise<unknown>)(span);
    },
  }),
}));

vi.mock("~/server/metrics", () => ({
  getStoredObjectExtractCounter: () => ({ inc: vi.fn() }),
  getStoredObjectDedupHitCounter: () => ({ inc: vi.fn() }),
  getStoredObjectWriteFailureCounter: () => ({ inc: vi.fn() }),
  getStoredObjectSizeBytesHistogram: () => ({ observe: vi.fn() }),
  storedObjectReadFailureCounter: { inc: vi.fn() },
  getEdgeMediaExtractFailOpenCounter: () => ({ inc: vi.fn() }),
}));

vi.mock("~/env.mjs", () => ({
  env: { S3_BUCKET_NAME: "" },
}));

// ---------------------------------------------------------------------------
// Globals + helpers
// ---------------------------------------------------------------------------

let ch: ClickHouseClient;
let tmpDir: string;

// Reassigned per test (see beforeEach): storage is content-addressed per
// project, so a shared project would couple tests through dedup hits on
// earlier tests' bytes. Helpers read this at call time, inside the test.
let PROJECT = `test-tme-proj-${nanoid(6)}`;

const testLogger = { info: vi.fn(), warn: vi.fn() };

/** Raw pcm-ish bytes; content is irrelevant, identity (sha256) is what matters. */
function makeAudioBytes(size = 4096): Buffer {
  const bytes = Buffer.alloc(size);
  for (let i = 0; i < size; i++) bytes[i] = (i * 31) % 251;
  return bytes;
}

/** The bytes the store receives for a raw pcm16 recording: WAV-wrapped at store time. */
function wavOf(audio: Buffer): Buffer {
  return Buffer.from(wrapRawPcmToWav(new Uint8Array(audio), "pcm16")!);
}

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const PDF_BYTES = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n",
  "utf8",
);

function sha256Of(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function makeSpan(
  attributes: OtlpSpan["attributes"],
  events: OtlpSpan["events"] = [],
): OtlpSpan {
  return {
    traceId: `trace-${nanoid(8)}`,
    spanId: `span-${nanoid(8)}`,
    name: "llm-call",
    kind: 1,
    startTimeUnixNano: { low: 0, high: 0 },
    endTimeUnixNano: { low: 1_000_000, high: 0 },
    attributes,
    events,
    links: [],
    status: { message: null, code: null },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  } as unknown as OtlpSpan;
}

function makeCommandData(span: OtlpSpan): RecordSpanCommandData {
  return {
    tenantId: PROJECT,
    span,
    resource: null,
    instrumentationScope: null,
    piiRedactionLevel: "STRICT",
    occurredAt: Date.now(),
  } as RecordSpanCommandData;
}

/** Messages payload carrying an AI-SDK file part with inline base64 audio. */
function audioMessages(audio: Buffer): unknown[] {
  return [
    {
      role: "user",
      content: [
        { type: "text", text: "ACME Freight dispatch, hello?" },
        {
          type: "file",
          mediaType: "audio/pcm16",
          data: audio.toString("base64"),
        },
      ],
    },
  ];
}

function buildService(projectId: string): StoredObjectsService {
  const driver = new LocalFilesystemDriver();
  const registry = new StorageRegistry({ file: driver, s3: driver });
  const repository = new StoredObjectsRepository();
  const mintUri: MintStorageUri = async ({ projectId: pid, sha256 }) =>
    mintFileUri({ root: tmpDir, projectId: pid, sha256 });
  return new StoredObjectsService(repository, registry, mintUri);
}

/** Default deps: flag on, no privacy rules, real service on tmp storage. */
function enabledDeps(service?: StoredObjectsService) {
  return {
    isEnabled: vi.fn().mockResolvedValue(true),
    hasContentDropRules: vi.fn().mockResolvedValue(false),
    createService: vi.fn(() => service ?? buildService(PROJECT)),
  };
}

function parseAttr(data: RecordSpanCommandData, key: string): unknown {
  const attr = data.span.attributes.find((a) => a.key === key);
  expect(attr?.value?.stringValue).toBeTypeOf("string");
  return JSON.parse(attr!.value!.stringValue!);
}

async function readStoredBytes(uri: string): Promise<Buffer> {
  const filePath = uri.replace("file://", "");
  return await fs.readFile(filePath);
}

async function chRowFor(id: string): Promise<{
  id: string;
  media_type: string;
  purpose: string;
  owner_kind: string;
  sha256: string;
} | null> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await ch.query({
      query: `SELECT id, media_type, purpose, owner_kind, sha256, storage_uri FROM stored_objects WHERE project_id = {projectId:String} AND id = {id:String} LIMIT 1`,
      query_params: { projectId: PROJECT, id },
      format: "JSONEachRow",
    });
    const rows = await result.json<{
      id: string;
      media_type: string;
      purpose: string;
      owner_kind: string;
      sha256: string;
      storage_uri: string;
    }>();
    if (rows.length > 0) return rows[0]!;
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;
  vi.mocked(
    clickhouseClientModule.getClickHouseClientForProject,
  ).mockResolvedValue(ch);
  vi.mocked(clickhouseClientModule.getSharedClickHouseClient).mockReturnValue(
    ch,
  );
}, 90_000);

afterAll(async () => {
  if (ch) {
    await ch.exec({
      query: `ALTER TABLE stored_objects DELETE WHERE project_id = {proj:String}`,
      query_params: { proj: PROJECT },
    });
  }
  await stopTestContainers();
});

beforeEach(async () => {
  PROJECT = `test-tme-proj-${nanoid(6)}`;
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tme-int-test-"));
  testLogger.info.mockClear();
  testLogger.warn.mockClear();
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("trace media extraction at the ingestion edge", () => {
  describe("given a span input carrying an AI-SDK audio file part", () => {
    /** @scenario "An AI-SDK audio file part inside a span input is externalized before staging" */
    it("externalizes the bytes and rewrites the part to an /api/files reference", async () => {
      const audio = makeAudioBytes();
      const span = makeSpan([
        {
          key: "langwatch.input",
          value: { stringValue: JSON.stringify(audioMessages(audio)) },
        },
      ]);
      const data = makeCommandData(span);

      const result = await maybeExtractSpanMedia({
        data,
        deps: enabledDeps(),
        logger: testLogger,
      });

      expect(result).not.toBe(data);
      const messages = parseAttr(result, "langwatch.input") as Array<{
        content: Array<Record<string, unknown>>;
      }>;
      const part = messages[0]!.content[1]! as {
        type: string;
        input_audio: { url: string; mimeType: string; data?: string };
      };
      expect(part.type).toBe("input_audio");
      // Raw pcm16 is WAV-wrapped at store time so the reference is playable
      expect(part.input_audio.mimeType).toBe("audio/wav");
      expect(part.input_audio.data).toBeUndefined();
      expect(part.input_audio.url).toMatch(
        new RegExp(`^/api/files/${PROJECT}/`),
      );
      // No base64 audio remains anywhere in the command payload
      expect(JSON.stringify(result)).not.toContain(audio.toString("base64"));

      // Bytes are stored content-addressed and readable back: the exact
      // pcm16 samples behind a canonical 44-byte WAV header.
      const id = part.input_audio.url.split("/").pop()!;
      const row = await chRowFor(id);
      expect(row).not.toBeNull();
      expect(row!.media_type).toBe("audio/wav");
      expect(row!.purpose).toBe(TRACE_MEDIA_PURPOSE);
      expect(row!.owner_kind).toBe("trace");
      expect(row!.sha256).toBe(sha256Of(wavOf(audio)));
      const stored = await readStoredBytes(
        mintFileUri({ root: tmpDir, projectId: PROJECT, sha256: row!.sha256 }),
      );
      expect(stored.equals(wavOf(audio))).toBe(true);
      expect(stored.subarray(44).equals(audio)).toBe(true);
    });
  });

  describe("given media nested inside a typed-raw JSON string", () => {
    /** @scenario "Media nested inside a typed-raw JSON string is still found" */
    it("rewrites through the nested string and preserves the envelope", async () => {
      const audio = makeAudioBytes(2048);
      const typedRaw = {
        type: "raw",
        value: JSON.stringify(audioMessages(audio)),
      };
      const span = makeSpan([
        {
          key: "langwatch.input",
          value: { stringValue: JSON.stringify(typedRaw) },
        },
      ]);

      const result = await maybeExtractSpanMedia({
        data: makeCommandData(span),
        deps: enabledDeps(),
        logger: testLogger,
      });

      const envelope = parseAttr(result, "langwatch.input") as {
        type: string;
        value: string;
      };
      expect(envelope.type).toBe("raw");
      expect(envelope.value).toBeTypeOf("string");
      const messages = JSON.parse(envelope.value) as Array<{
        content: Array<{ type: string; input_audio?: { url?: string } }>;
      }>;
      expect(messages[0]!.content[1]!.type).toBe("input_audio");
      expect(messages[0]!.content[1]!.input_audio!.url).toContain(
        "/api/files/",
      );
      expect(JSON.stringify(result)).not.toContain(audio.toString("base64"));
    });
  });

  describe("given a data-URI image and a PDF file part", () => {
    /** @scenario "A data-URI image inside an image_url part is externalized" */
    it("externalizes the image keeping the image_url shape", async () => {
      const span = makeSpan([
        {
          key: "langwatch.input",
          value: {
            stringValue: JSON.stringify([
              {
                role: "user",
                content: [
                  {
                    type: "image_url",
                    image_url: {
                      url: `data:image/png;base64,${PNG_BYTES.toString("base64")}`,
                    },
                  },
                ],
              },
            ]),
          },
        },
      ]);

      const result = await maybeExtractSpanMedia({
        data: makeCommandData(span),
        deps: enabledDeps(),
        logger: testLogger,
      });

      const messages = parseAttr(result, "langwatch.input") as Array<{
        content: Array<{ type: string; image_url: { url: string } }>;
      }>;
      const part = messages[0]!.content[0]!;
      expect(part.type).toBe("image_url");
      expect(part.image_url.url).toMatch(new RegExp(`^/api/files/${PROJECT}/`));
      const id = part.image_url.url.split("/").pop()!;
      const row = await chRowFor(id);
      expect(row?.media_type).toBe("image/png");
    });

    /** @scenario "A PDF file part is externalized to a binary reference preserving the filename" */
    it("externalizes the PDF to a binary reference preserving the filename", async () => {
      const span = makeSpan([
        {
          key: "langwatch.output",
          value: {
            stringValue: JSON.stringify([
              {
                role: "assistant",
                content: [
                  {
                    type: "file",
                    file: {
                      filename: "report.pdf",
                      file_data: `data:application/pdf;base64,${PDF_BYTES.toString("base64")}`,
                    },
                  },
                ],
              },
            ]),
          },
        },
      ]);

      const result = await maybeExtractSpanMedia({
        data: makeCommandData(span),
        deps: enabledDeps(),
        logger: testLogger,
      });

      const attr = result.span.attributes.find(
        (a) => a.key === "langwatch.output",
      );
      const messages = JSON.parse(attr!.value!.stringValue!) as Array<{
        content: Array<{
          type: string;
          mimeType?: string;
          url?: string;
          filename?: string;
          data?: string;
        }>;
      }>;
      const part = messages[0]!.content[0]!;
      expect(part.type).toBe("binary");
      expect(part.mimeType).toBe("application/pdf");
      expect(part.filename).toBe("report.pdf");
      expect(part.data).toBeUndefined();
      expect(part.url).toMatch(new RegExp(`^/api/files/${PROJECT}/`));
    });
  });

  describe("given the same recording already stored by a scenario event", () => {
    /** @scenario "The same recording on a scenario event and on a trace is stored once" */
    it("dedups the trace-side extraction to the same stored object", async () => {
      const audio = makeAudioBytes(8192);
      const service = buildService(PROJECT);

      // Scenario path stores the recording first (same walker vocabulary).
      const { refs: scenarioRefs } = await extractInlineMediaFromEvent({
        event: {
          message: {
            role: "user",
            content: [
              {
                type: "input_audio",
                input_audio: {
                  data: audio.toString("base64"),
                  mimeType: "audio/pcm16",
                },
              },
            ],
          },
        },
        projectId: PROJECT,
        ownerKind: "scenario_run",
        ownerId: "scenario-run-1",
        purpose: "scenario_event",
        service,
      });
      expect(scenarioRefs).toHaveLength(1);
      expect(scenarioRefs[0]!.isDuplicate).toBe(false);

      // Trace path observes the byte-identical recording.
      const span = makeSpan([
        {
          key: "langwatch.input",
          value: { stringValue: JSON.stringify(audioMessages(audio)) },
        },
      ]);
      const result = await maybeExtractSpanMedia({
        data: makeCommandData(span),
        deps: enabledDeps(service),
        logger: testLogger,
      });

      const messages = parseAttr(result, "langwatch.input") as Array<{
        content: Array<{ input_audio?: { url: string } }>;
      }>;
      const url = messages[0]!.content[1]!.input_audio!.url;
      expect(url.split("/").pop()).toBe(scenarioRefs[0]!.id);

      // Exactly one copy of the bytes exists on disk for the project.
      const files = await fs.readdir(path.join(tmpDir, PROJECT));
      expect(files.filter((f) => f === sha256Of(wavOf(audio)))).toHaveLength(1);
    });
  });

  describe("given a span whose only oversized content is a 2 MB audio part", () => {
    /** @scenario "Extraction before the spool check keeps the queue light" */
    it("keeps the payload under the spool threshold so no spool object is written", async () => {
      const audio = makeAudioBytes(2 * 1024 * 1024);
      const span = makeSpan([
        {
          key: "langwatch.input",
          value: { stringValue: JSON.stringify(audioMessages(audio)) },
        },
      ]);
      const data = makeCommandData(span);
      expect(Buffer.byteLength(JSON.stringify(data), "utf8")).toBeGreaterThan(
        COMMAND_INLINE_THRESHOLD,
      );

      const extracted = await maybeExtractSpanMedia({
        data,
        deps: enabledDeps(),
        logger: testLogger,
      });
      expect(Buffer.byteLength(JSON.stringify(extracted), "utf8")).toBeLessThan(
        COMMAND_INLINE_THRESHOLD,
      );

      const putSpool = vi.fn();
      const spooled = await maybeSpool({
        data: extracted,
        blobStore: { putSpool } as unknown as BlobStore,
        logger: { warn: vi.fn() },
      });
      expect(putSpool).not.toHaveBeenCalled();
      expect(spooled).toBe(extracted);
    });
  });

  describe("given the object store rejects writes", () => {
    /** @scenario "A storage failure falls back to inline ingestion (fail-open)" */
    it("fails open and returns the original command data", async () => {
      const driver = new LocalFilesystemDriver();
      const registry = new StorageRegistry({ file: driver, s3: driver });
      const repository = new StoredObjectsRepository();
      // Minting under a path whose parent is a FILE makes the driver's mkdir
      // fail — a real storage write error, not a mocked one.
      const blockerFile = path.join(tmpDir, "not-a-dir");
      await fs.writeFile(blockerFile, "x");
      const mintUri: MintStorageUri = async ({ projectId: pid, sha256 }) =>
        mintFileUri({ root: blockerFile, projectId: pid, sha256 });
      const brokenService = new StoredObjectsService(
        repository,
        registry,
        mintUri,
      );

      const audio = makeAudioBytes(4444);
      const span = makeSpan([
        {
          key: "langwatch.input",
          value: { stringValue: JSON.stringify(audioMessages(audio)) },
        },
      ]);
      const data = makeCommandData(span);

      const result = await maybeExtractSpanMedia({
        data,
        deps: enabledDeps(brokenService),
        logger: testLogger,
      });

      // Per-part fail-open: the failed part stays inline (no rewrite at all
      // here, so the command data passes through by identity) and the drop is
      // logged and counted — never silent, never blocking ingestion.
      expect(result).toBe(data);
      expect(testLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ failedParts: 1 }),
        expect.stringContaining("stay inline"),
      );
    });
  });

  describe("given attributes without media markers", () => {
    /** @scenario "Attributes without media markers are never parsed or rewritten" */
    it("passes the command through untouched without any dependency reads", async () => {
      const deps = enabledDeps();
      const span = makeSpan([
        {
          key: "langwatch.input",
          value: {
            stringValue: JSON.stringify([
              { role: "user", content: "plain text question" },
            ]),
          },
        },
        {
          key: "langwatch.params",
          value: { stringValue: `{"temperature":0.2}` },
        },
      ]);
      const data = makeCommandData(span);

      const result = await maybeExtractSpanMedia({
        data,
        deps,
        logger: testLogger,
      });

      expect(result).toBe(data);
      expect(deps.isEnabled).not.toHaveBeenCalled();
      expect(deps.createService).not.toHaveBeenCalled();
    });
  });

  describe("given media carried on a span event attribute", () => {
    /** @scenario "Media carried on span events is externalized like span attributes" */
    it("rewrites the event attribute like a span attribute", async () => {
      const audio = makeAudioBytes(1024);
      const span = makeSpan([], [
        {
          timeUnixNano: { low: 0, high: 0 },
          name: "gen_ai.content.prompt",
          attributes: [
            {
              key: "gen_ai.prompt",
              value: { stringValue: JSON.stringify(audioMessages(audio)) },
            },
          ],
          droppedAttributesCount: 0,
        },
      ] as unknown as OtlpSpan["events"]);

      const result = await maybeExtractSpanMedia({
        data: makeCommandData(span),
        deps: enabledDeps(),
        logger: testLogger,
      });

      const eventAttr = result.span.events[0]!.attributes[0]!;
      const messages = JSON.parse(eventAttr.value!.stringValue!) as Array<{
        content: Array<{ type: string }>;
      }>;
      expect(messages[0]!.content[1]!.type).toBe("input_audio");
      expect(JSON.stringify(result)).not.toContain(audio.toString("base64"));
    });
  });

  describe("given the flag is disabled for the project", () => {
    /** @scenario "The flag disabled keeps ingestion byte-identical to today" */
    it("returns the command data unchanged and stores nothing", async () => {
      const deps = {
        ...enabledDeps(),
        isEnabled: vi.fn().mockResolvedValue(false),
      };
      const audio = makeAudioBytes();
      const span = makeSpan([
        {
          key: "langwatch.input",
          value: { stringValue: JSON.stringify(audioMessages(audio)) },
        },
      ]);
      const data = makeCommandData(span);

      const result = await maybeExtractSpanMedia({
        data,
        deps,
        logger: testLogger,
      });

      expect(result).toBe(data);
      expect(deps.createService).not.toHaveBeenCalled();
    });
  });

  describe("given the project has data-privacy content-drop rules", () => {
    /** @scenario "A project with a content-drop policy skips edge extraction" */
    it("skips extraction so no bytes are persisted at the edge", async () => {
      const deps = {
        ...enabledDeps(),
        hasContentDropRules: vi.fn().mockResolvedValue(true),
      };
      const audio = makeAudioBytes();
      const span = makeSpan([
        {
          key: "langwatch.input",
          value: { stringValue: JSON.stringify(audioMessages(audio)) },
        },
      ]);
      const data = makeCommandData(span);

      const result = await maybeExtractSpanMedia({
        data,
        deps,
        logger: testLogger,
      });

      expect(result).toBe(data);
      expect(deps.createService).not.toHaveBeenCalled();
    });
  });

  describe("given an already-rewritten span re-enters the hook (queue retry)", () => {
    /** @scenario "A queue retry after extraction re-stages the already-rewritten command" */
    it("performs no writes and returns the data unchanged", async () => {
      const audio = makeAudioBytes();
      const span = makeSpan([
        {
          key: "langwatch.input",
          value: { stringValue: JSON.stringify(audioMessages(audio)) },
        },
      ]);
      const service = buildService(PROJECT);
      const storeSpy = vi.spyOn(service, "storeFromBytes");

      const first = await maybeExtractSpanMedia({
        data: makeCommandData(span),
        deps: enabledDeps(service),
        logger: testLogger,
      });
      const writesAfterFirst = storeSpy.mock.calls.length;
      expect(writesAfterFirst).toBeGreaterThan(0);

      const second = await maybeExtractSpanMedia({
        data: first,
        deps: enabledDeps(service),
        logger: testLogger,
      });

      expect(second).toBe(first);
      expect(storeSpy.mock.calls.length).toBe(writesAfterFirst);
    });
  });
});
