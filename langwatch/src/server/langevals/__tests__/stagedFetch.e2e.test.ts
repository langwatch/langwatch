/**
 * End-to-end proof that the stagedLangevalsFetch helper + the langevals
 * StagedPayloadMiddleware round-trip a real payload through real S3.
 *
 * Skipped unless LANGEVALS_E2E_ENABLED=1 because it needs:
 *   - AWS credentials reachable via the SDK default chain
 *     (set AWS_PROFILE=lw-dev and refresh SSO before running)
 *   - the langevals uv venv synced with the `langevals` + `topic_clustering`
 *     extras (uv resolves these on first `uv run`)
 *   - LANGEVALS_STAGING_THRESHOLD_BYTES set low enough to force staging
 *   - OPENAI_API_KEY available (vitest auto-loads from langwatch/.env)
 *
 * Run locally:
 *   pnpm test:e2e:langevals-staging
 * CI does not run it (no shared dev S3 creds in GH Actions).
 *
 * Scenarios proven end-to-end (with threshold = 200 bytes both
 * evaluator scenarios force the staged path; the inline branch is
 * covered exhaustively by the unit tests, no value duplicating it here):
 *   1. llm_boolean payload stages via real S3, langevals middleware
 *      fetches it, evaluator calls real OpenAI, returns a real verdict
 *      with non-zero cost. Proves the LLM-as-judge path survives the
 *      staging hop end-to-end.
 *   2. topic_clustering_batch payload stages, langevals fetches it,
 *      calls real OpenAI embeddings + naming model, returns at least
 *      one named topic with traces assigned to it. Asserts the response
 *      body shape and content, not just log lines.
 *
 * Both scenarios also assert the staged S3 object is gone after the call
 * returns — the in-app finally deletes it, so nothing lingers in the
 * bucket. The "fetched staged payload" log proves the body round-tripped
 * through S3 before the delete.
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

  it("stages a large llm_boolean payload, real OpenAI runs after the S3 hop", async () => {
    const h = harness!;

    const padding = "x".repeat(2000);
    const response = await stagedLangevalsFetch({
      url: `${h.baseUrl}/langevals/llm_boolean/evaluate`,
      projectId: "project_e2e_eval",
      kind: "evaluation",
      body: {
        data: [
          {
            input: "What is the capital of France?",
            output: `The capital of France is Paris. ${padding}`,
            contexts: [`London is the capital of France. ${padding}`],
          },
        ],
        settings: {
          model: "openai/gpt-5-mini",
          prompt:
            "You are an LLM evaluator. Evaluate as False if the output does not match what the provided context says, regardless of factual accuracy.",
        },
        env: { OPENAI_API_KEY: requireOpenAIKey() },
      },
    });

    expect(response.status).toBe(200);
    const json = (await response.json()) as Array<EvalResult>;
    const verdict = json[0];
    // eslint-disable-next-line no-console
    console.log("[e2e proof] llm_boolean verdict:", JSON.stringify(verdict));
    expect(verdict?.status).toBe("processed");
    expect(typeof verdict?.passed).toBe("boolean");
    expect((verdict?.cost?.amount ?? 0) > 0).toBe(true);

    // langevals emitting "fetched staged payload" proves the body did
    // round-trip through S3 (the middleware pulled the presigned URL).
    await waitForLog(h, "fetched staged payload", 5_000);

    // ...and after the call returns, the in-app finally must have
    // deleted the staged object, so nothing lingers in the bucket.
    const staged = await listStagingObjects(h);
    const matching = staged.filter((k) =>
      k.includes("project_e2e_eval/evaluation/"),
    );
    expect(matching).toEqual([]);
  }, 120_000);

  it("stages a topic_clustering_batch payload and returns real named topics", async () => {
    const h = harness!;
    const apiKey = requireOpenAIKey();

    // Two semantically distinct clusters, both above the
    // MINIMUM_TRACES_PER_TOPIC=5 threshold so the hierarchy actually
    // returns at least one topic. Real embeddings differentiate them.
    const weather = [
      "Why is the sky blue during the day?",
      "What causes blue color in the sky?",
      "Why does the daytime sky look blue from earth?",
      "Explain blue sky scattering of sunlight.",
      "Rayleigh scattering and the blue color of the sky",
      "Why is the sky not green or red but blue?",
    ];
    const python = [
      "How do I open a file in Python and read its contents?",
      "Python file reading best practices with context managers",
      "How can I parse JSON files in Python?",
      "Reading large CSV files efficiently in Python",
      "How do I write bytes to a file in Python?",
      "Python pathlib vs os.path for reading files",
    ];

    const traces = [...weather, ...python].map((input, i) => ({
      trace_id: `trace_e2e_${i}`,
      input,
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
          model: "openai/gpt-5-mini",
          api_key: apiKey,
        },
        embeddings_litellm_params: {
          model: "openai/text-embedding-3-small",
          api_key: apiKey,
        },
        traces,
      },
    });

    expect(response.status).toBe(200);
    const json = (await response.json()) as TopicClusteringResponse;
    // eslint-disable-next-line no-console
    console.log(
      "[e2e proof] topics:",
      JSON.stringify(json.topics),
      "subtopics:",
      JSON.stringify(json.subtopics),
      "trace_assignments:",
      JSON.stringify(json.traces),
    );

    expect(Array.isArray(json.topics)).toBe(true);
    expect(json.topics.length).toBeGreaterThan(0);
    expect(json.topics[0]?.name).toBeTruthy();

    expect(Array.isArray(json.traces)).toBe(true);
    expect(json.traces.length).toBeGreaterThan(0);
    for (const t of json.traces) {
      expect(typeof t.trace_id).toBe("string");
      expect(typeof t.topic_id).toBe("string");
    }

    // Round-trip proof: langevals fetched the staged body from S3.
    await waitForLog(h, "fetched staged payload", 10_000);

    // Cleanup proof: the staged object is deleted after the call returns.
    const staged = await listStagingObjects(h);
    const matching = staged.filter((k) =>
      k.includes("project_e2e_topics/topic_clustering_batch/"),
    );
    expect(matching).toEqual([]);
  }, 180_000);
});

interface EvalResult {
  status?: string;
  passed?: boolean;
  score?: number;
  details?: string;
  cost?: { amount?: number; currency?: string } | null;
}

interface TopicClusteringResponse {
  topics: Array<{ id: string; name: string }>;
  subtopics: Array<{ id: string; name: string; parent_id: string }>;
  traces: Array<{
    trace_id: string;
    topic_id: string;
    subtopic_id: string | null;
  }>;
  cost: { amount: number; currency: string } | null;
}

function requireOpenAIKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error(
      "OPENAI_API_KEY must be set for the staged-payload e2e (the wrapper script sources it from langwatch/.env)",
    );
  }
  return key;
}

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

  // The npm script (`pnpm test:e2e:langevals-staging`) pre-resolves the
  // AWS profile to S3_ACCESS_KEY_ID/SECRET/SESSION_TOKEN before invoking
  // vitest, because the AWS SDK's default credential chain can't be
  // loaded inside vitest's vite-node resolver (see
  // https://github.com/aws/aws-sdk-js-v3/issues/4953 — surfaces as
  // "Invalid URL" on the credential-provider-node module path). Bucket
  // + region default to the lw-dev values for a one-command run.
  const bucket = process.env.S3_BUCKET_NAME ?? "runtime-storage-dev";
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
