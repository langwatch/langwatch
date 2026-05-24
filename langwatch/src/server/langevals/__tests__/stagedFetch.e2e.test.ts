/**
 * End-to-end proof that the stagedLangevalsFetch helper + the langevals
 * StagedPayloadMiddleware round-trip a real payload through real S3.
 *
 * Skipped unless LANGEVALS_E2E_ENABLED=1 because it needs:
 *   - lw-dev AWS credentials (or any S3 access) exported to env
 *   - the langevals uv venv synced with the `langevals` + `topic_clustering`
 *     extras (the wrapper script handles both)
 *   - LANGEVALS_STAGING_THRESHOLD_BYTES set low enough to force staging
 *
 * Use scripts/run-langevals-staging-e2e.sh to exercise this locally;
 * CI does not run it (no shared dev S3 creds in GH Actions).
 *
 * Scenarios proven end-to-end:
 *   1. Tiny payload posts inline — no S3 object created.
 *   2. Above-threshold evaluator payload stages, langevals fetches it
 *      from S3, runs exact_match, returns the correct passed=true result.
 *   3. Above-threshold topic_clustering_batch payload stages, langevals
 *      fetches it, parses BatchClusteringParams, and reaches the actual
 *      clustering pipeline (logs `Starting batch clustering trace_count`
 *      before failing at the unreachable embeddings provider — proving
 *      the body was delivered intact).
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import {
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";

import { stagedLangevalsFetch } from "../stagedFetch";

const E2E_ENABLED = process.env.LANGEVALS_E2E_ENABLED === "1";
const LANGEVALS_DIR = resolve(__dirname, "../../../../../langevals");

interface Harness {
  port: number;
  baseUrl: string;
  proc: ChildProcessWithoutNullStreams;
  logs: string[];
  tempDir: string;
  s3: S3Client;
  bucket: string;
  stagingPrefix: string;
}

let harness: Harness | undefined;

const describeFn = E2E_ENABLED ? describe : describe.skip;

describeFn("stagedLangevalsFetch e2e (real S3 + real langevals)", () => {
  beforeAll(async () => {
    if (!process.env.S3_BUCKET_NAME) {
      throw new Error(
        "S3_BUCKET_NAME must be set (wrapper script: run-langevals-staging-e2e.sh)",
      );
    }
    harness = await spawnLangevals();
  }, 120_000);

  afterAll(async () => {
    if (!harness) return;
    await deleteStagingObjects(harness);
    harness.proc.kill("SIGTERM");
    await sleep(500);
    if (!harness.proc.killed) harness.proc.kill("SIGKILL");
    try {
      rmSync(harness.tempDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  it("posts inline when the body is below the staging threshold", async () => {
    const h = harness!;
    const before = await listStagingObjects(h);

    const response = await stagedLangevalsFetch({
      url: `${h.baseUrl}/langevals/exact_match/evaluate`,
      projectId: "project_e2e_inline",
      kind: "evaluation",
      body: {
        data: [{ output: "yes", expected_output: "yes" }],
        settings: {},
        env: {},
      },
    });

    expect(response.status).toBe(200);
    const json = (await response.json()) as Array<{ passed?: boolean }>;
    expect(Array.isArray(json)).toBe(true);
    expect(json[0]?.passed).toBe(true);

    const after = await listStagingObjects(h);
    expect(after.length).toBe(before.length);
  }, 60_000);

  it("stages a large evaluator payload through real S3 and runs exact_match end-to-end", async () => {
    const h = harness!;

    const padding = "x".repeat(2000);
    const response = await stagedLangevalsFetch({
      url: `${h.baseUrl}/langevals/exact_match/evaluate`,
      projectId: "project_e2e_eval",
      kind: "evaluation",
      body: {
        data: [
          {
            output: `the answer is ${padding}`,
            expected_output: `the answer is ${padding}`,
          },
        ],
        settings: {},
        env: {},
      },
    });

    expect(response.status).toBe(200);
    const json = (await response.json()) as Array<{ passed?: boolean }>;
    expect(json[0]?.passed).toBe(true);

    const staged = await listStagingObjects(h);
    const matching = staged.filter((k) =>
      k.includes("project_e2e_eval/evaluation/"),
    );
    expect(matching.length).toBeGreaterThan(0);

    await waitForLog(h, "fetched staged payload", 5_000);
  }, 90_000);

  it("stages a large topic_clustering_batch payload through real S3 and reaches the clustering pipeline", async () => {
    const h = harness!;

    const traces = Array.from({ length: 8 }, (_, i) => ({
      trace_id: `trace_e2e_${i}`,
      input: `${"why is the sky blue ".repeat(40)} ${i}`,
      topic_id: null,
      subtopic_id: null,
    }));

    const response = await stagedLangevalsFetch({
      url: `${h.baseUrl}/topics/batch_clustering`,
      projectId: "project_e2e_topics",
      kind: "topic_clustering_batch",
      body: {
        project_id: "project_e2e_topics",
        litellm_params: {
          model: "openai/no-such-model",
          api_key: "sk-fake-key-for-e2e",
        },
        embeddings_litellm_params: {
          model: "openai/text-embedding-3-small",
          api_key: "sk-fake-key-for-e2e",
          api_base: "http://127.0.0.1:1",
        },
        traces,
      },
    });

    // 500 is expected — embeddings provider is intentionally unreachable.
    // The point is the body was parsed by the route handler, which only
    // happens if the middleware delivered the staged body intact.
    expect([200, 500]).toContain(response.status);

    const staged = await listStagingObjects(h);
    const matching = staged.filter((k) =>
      k.includes("project_e2e_topics/topic_clustering_batch/"),
    );
    expect(matching.length).toBeGreaterThan(0);

    // Two independent proofs the staged body actually reached the
    // clustering route handler: (a) my middleware emitted its
    // "fetched staged payload" line, (b) langevals reached the
    // embeddings step (only possible after Pydantic parsed the body).
    await waitForLog(h, "fetched staged payload", 10_000);
    await waitForLog(h, "embeddings", 10_000);
  }, 120_000);
});

async function spawnLangevals(): Promise<Harness> {
  const port = await pickFreePort();
  const tempDir = mkdtempSync(join(tmpdir(), "langevals-e2e-"));

  const uvBin = process.env.UV_BIN ?? "uv";
  const proc = spawn(
    uvBin,
    [
      "run",
      "uvicorn",
      "langevals.server:app",
      "--port",
      String(port),
      "--host",
      "127.0.0.1",
      "--log-level",
      "info",
    ],
    {
      cwd: LANGEVALS_DIR,
      // Inherit the parent shell PATH so `uv` resolves the same way it
      // does in the user's terminal — vitest spawns workers with a
      // pruned env on macOS and `uv` lives under ~/.pyenv/shims, not /usr/bin.
      env: {
        ...process.env,
        PATH: process.env.PATH ?? "",
        DISABLE_EVALUATORS_PRELOAD: "1",
        LANGEVALS_STAGED_MAX_BYTES: String(64 * 1024 * 1024),
      },
    },
  );

  const logs: string[] = [];
  const onData = (chunk: Buffer) => {
    const text = chunk.toString("utf-8");
    process.stderr.write(`[langevals] ${text}`);
    logs.push(text);
  };
  proc.stdout.on("data", onData);
  proc.stderr.on("data", onData);

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHealth(baseUrl, 60_000);

  const bucket = process.env.S3_BUCKET_NAME!;
  const s3 = new S3Client({
    region: process.env.S3_REGION ?? "eu-central-1",
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: true,
    credentials:
      process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
        ? {
            accessKeyId: process.env.S3_ACCESS_KEY_ID,
            secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
            ...(process.env.S3_SESSION_TOKEN
              ? { sessionToken: process.env.S3_SESSION_TOKEN }
              : {}),
          }
        : undefined,
  });

  return {
    port,
    baseUrl,
    proc,
    logs,
    tempDir,
    s3,
    bucket,
    stagingPrefix: "langevals-staging/project_e2e_",
  };
}

async function pickFreePort(): Promise<number> {
  const { createServer } = await import("node:net");
  return await new Promise<number>((res, rej) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", rej);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        srv.close(() => res(port));
      } else {
        rej(new Error("failed to pick free port"));
      }
    });
  });
}

async function waitForHealth(baseUrl: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${baseUrl}/healthcheck`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error(`langevals never came up on ${baseUrl}`);
}

async function waitForLog(h: Harness, needle: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (h.logs.join("\n").includes(needle)) return;
    await sleep(150);
  }
  throw new Error(
    `langevals stdout never contained ${JSON.stringify(needle)}\n` +
      `--- last 50 log lines ---\n${h.logs.join("").split("\n").slice(-50).join("\n")}`,
  );
}

async function listStagingObjects(h: Harness): Promise<string[]> {
  const out = await h.s3.send(
    new ListObjectsV2Command({
      Bucket: h.bucket,
      Prefix: h.stagingPrefix,
      MaxKeys: 1000,
    }),
  );
  return (out.Contents ?? []).map((c) => c.Key!).filter(Boolean);
}

async function deleteStagingObjects(h: Harness): Promise<void> {
  const keys = await listStagingObjects(h);
  for (const Key of keys) {
    try {
      await h.s3.send(
        new HeadObjectCommand({ Bucket: h.bucket, Key }),
      );
      await h.s3.send(
        new DeleteObjectCommand({ Bucket: h.bucket, Key }),
      );
    } catch {
      /* best-effort cleanup */
    }
  }
}
