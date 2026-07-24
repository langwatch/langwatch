/**
 * @vitest-environment node
 *
 * REAL end-to-end proof of the oversized-invoke S3 staging path, across the
 * full cross-language contract that the unit tests can only mock:
 *
 *   TS sender  ->  real stagePayloadToS3 uploads a >6 MiB body to a REAL S3
 *                  bucket and returns a presigned GET URL
 *   wire       ->  the presigned URL rides in the X-Payload-S3-URL header
 *   Go receiver->  live nlpgo readStudioRequestBody fetches the FULL body back
 *                  from S3 and the engine executes it to a correct result
 *
 * The only hop this does NOT exercise is the AWS Lambda InvokeFunction
 * transport itself (that is AWS infra, not our code, and dev has no per-project
 * nlpgo Lambda — they are prod-only). Its sole relevance is the 6 MiB Payload
 * cap, which staging exists to dodge; we assert the body would breach that cap.
 *
 * What this proves that the mocks cannot:
 *   - the REAL presigned URL host that createS3Client emits passes the Go
 *     SSRF guard (validateStagedPayloadURL / isAWSS3Host). A custom S3_ENDPOINT
 *     (VPCE / accelerate / R2) would silently fail this in prod.
 *   - the receiver fetches the WHOLE body (a sentinel at the very end of the
 *     >6 MiB blob survives the round-trip), not a truncated prefix.
 *   - nlpgo decodes + executes the fetched body to the expected output.
 *
 * Skipped (not failed) in CI and locally unless explicitly opted in:
 *   - S3_DOGFOOD_BUCKET unset (no real bucket wired) -> skip
 *   - go not on PATH -> skip
 *
 * To run locally against lw-dev (eu-central-1):
 *   bash langwatch/scripts/refresh-dev-s3-env.sh   # fresh SSO creds in .env
 *   S3_DOGFOOD_BUCKET=runtime-storage-dev \
 *   S3_BUCKET_NAME=runtime-storage-dev \
 *   S3_REGION=eu-central-1 \
 *   npx vitest run src/server/nlpgo/__tests__/lambda-payload-staging.e2e.integration.test.ts
 */
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  STAGED_PAYLOAD_HEADER,
  deleteStagedObject,
  stagePayloadToS3,
  type StagedObject,
} from "../../s3/stagePayload";
import {
  hasGo,
  startNlpgoSubprocess,
  type NlpgoSubprocess,
} from "./_nlpgoSubprocess";

// AWS Lambda synchronous InvokeFunction Payload cap. A body over this fails
// inline with "Request must be smaller than 6291456 bytes for the
// InvokeFunction operation" — the exact prod error staging fixes.
const LAMBDA_INVOKE_CAP_BYTES = 6_291_456;

const DOGFOOD_BUCKET = process.env.S3_DOGFOOD_BUCKET;
// Opt-in: needs a real S3 bucket wired + the Go toolchain. Skips in CI and
// locally otherwise, so it never runs without explicit dev-storage creds.
const runE2E = !!DOGFOOD_BUCKET && hasGo();

// TS mirror of the Go SSRF guard (services/nlpgo/adapters/httpapi/
// staged_payload.go isAWSS3Host) so we can assert the REAL presigned host our
// code emits is one the receiver will accept, independent of the live fetch.
function isAWSS3Host(host: string): boolean {
  const h = host.toLowerCase();
  if (!h.endsWith(".amazonaws.com")) return false;
  if (h.startsWith("s3.") || h.startsWith("s3-")) return true;
  return h.includes(".s3.") || h.includes(".s3-");
}

const PORT = 55620; // nlpgo subprocess test range (see CLAUDE.md / _nlpgoSubprocess)
const PROJECT_ID = "dogfood-staging-project";
const KEY_PREFIX = "nlpgo-staging-dogfood/" + PROJECT_ID;

/**
 * A passthrough entry -> end workflow: the engine copies the entry dataset
 * value straight to the end output with no LLM call, so the run is
 * deterministic and free. The dataset value is huge enough to push the
 * serialized event past the 6 MiB cap, ending in a unique sentinel so a
 * truncated fetch would be observable in the echoed result.
 */
function buildOversizedExecuteFlowEvent(sentinel: string): {
  event: unknown;
  blob: string;
} {
  // ~7 MiB of payload + the sentinel as the final bytes of the blob.
  const blob = "x".repeat(7_000_000) + sentinel;
  const workflow = {
    workflow_id: "staging-e2e",
    api_key: "k",
    spec_version: "1.3",
    name: "Staging E2E",
    icon: "🧪",
    description: "oversized staged-payload round-trip",
    version: "1.3",
    template_adapter: "default",
    nodes: [
      {
        id: "entry",
        type: "entry",
        data: {
          outputs: [{ identifier: "blob", type: "str" }],
          dataset: { inline: { records: { blob: [blob] } } },
          entry_selection: 0,
          train_size: 1.0,
          test_size: 0.0,
          seed: 1,
        },
      },
      {
        id: "end",
        type: "end",
        data: { inputs: [{ identifier: "blob", type: "str" }] },
      },
    ],
    edges: [
      {
        id: "e1",
        source: "entry",
        sourceHandle: "outputs.blob",
        target: "end",
        targetHandle: "inputs.blob",
        type: "default",
      },
    ],
    state: {},
  };

  const event = {
    type: "execute_flow",
    payload: {
      trace_id: "staging-e2e-trace",
      workflow,
      inputs: [{}],
      origin: "workflow",
    },
  };
  return { event, blob };
}

describe("oversized nlpgo invoke staged through real S3 to live nlpgo", () => {
  let nlpgo: NlpgoSubprocess | null = null;

  beforeAll(async () => {
    if (!runE2E) return;
    nlpgo = await startNlpgoSubprocess({ port: PORT });
  }, 120_000);

  afterAll(async () => {
    await nlpgo?.stop();
  });

  describe("given an oversized invoke body staged to S3", () => {
    describe("when nlpgo receives an empty body with the staged-payload header", () => {
      /** @scenario "A real oversized payload round-trips through S3 to the live engine" */
      it.skipIf(!runE2E)(
        "stages a >6 MiB body to S3 and the receiver fetches + executes the full payload",
        async () => {
          const sentinel = `SENTINEL-${Date.now()}-end`;
          const { event, blob } = buildOversizedExecuteFlowEvent(sentinel);
          const bodyStr = JSON.stringify(event);
          const bodyBytes = Buffer.byteLength(bodyStr, "utf-8");

          // The body would breach the synchronous InvokeFunction cap if inlined —
          // i.e. staging is genuinely required, not incidental.
          expect(bodyBytes).toBeGreaterThan(LAMBDA_INVOKE_CAP_BYTES);

          let staged: StagedObject | null = null;
          try {
            staged = await stagePayloadToS3({
              projectId: PROJECT_ID,
              keyPrefix: KEY_PREFIX,
              serialized: Buffer.from(bodyStr, "utf-8"),
              ttlSeconds: 600,
            });

            // The REAL presigned host our code emits must be one the Go receiver
            // accepts; a custom endpoint that fails this is a latent prod bug.
            const host = new URL(staged.stagedUrl).host;
            expect(new URL(staged.stagedUrl).protocol).toBe("https:");
            expect(
              isAWSS3Host(host),
              `presigned host ${host} must pass the Go SSRF guard`,
            ).toBe(true);

            // Object actually LANDED in S3 at the full body size — proven against
            // S3 directly, independent of the receiver fetch.
            const head = await staged.s3Client.send(
              new HeadObjectCommand({
                Bucket: staged.s3Bucket,
                Key: staged.key,
              }),
            );
            expect(head.ContentLength).toBe(bodyBytes);

            // Empty body + staged header = exactly what lambdaFetch sends and what
            // readStudioRequestBody fetches from S3 instead of the inline body.
            const res = await fetch(
              `${nlpgo!.baseUrl}/go/studio/execute_sync`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  [STAGED_PAYLOAD_HEADER]: staged.stagedUrl,
                },
                body: "",
              },
            );

            expect(res.status).toBe(200);
            const result = (await res.json()) as {
              status: string;
              result?: { blob?: string };
              error?: { message?: string };
            };
            expect(result.status, JSON.stringify(result.error)).toBe("success");

            // Full-fetch proof: the echoed value is byte-complete (same length and
            // the sentinel that lived at the very end of the >6 MiB blob survived),
            // so nlpgo fetched the whole object, not a 6 MiB-truncated prefix.
            expect(result.result?.blob?.length).toBe(blob.length);
            expect(result.result?.blob?.endsWith(sentinel)).toBe(true);

            // eslint-disable-next-line no-console
            console.log(
              `[dogfood] staged ${bodyBytes} bytes -> s3://${staged.s3Bucket}/${staged.key} ` +
                `(host ${host}, isAWSS3Host=true); nlpgo echoed ${result.result?.blob?.length} bytes ` +
                `ending in the sentinel -> full round-trip OK`,
            );

            // Reap it and PROVE it is gone — the staged object carries customer
            // trace data, so the finally-delete must actually remove it.
            const reaped = staged;
            staged = null;
            await deleteStagedObject({
              s3Client: reaped.s3Client,
              s3Bucket: reaped.s3Bucket,
              key: reaped.key,
              projectId: PROJECT_ID,
            });
            // Require the specific missing-key response (404), not just any
            // error — an AccessDenied / expired-creds failure must NOT pass for
            // "it is gone".
            await expect(
              reaped.s3Client.send(
                new HeadObjectCommand({
                  Bucket: reaped.s3Bucket,
                  Key: reaped.key,
                }),
              ),
            ).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
          } finally {
            // Error-path cleanup only: the happy path already reaped + nulled it.
            if (staged) {
              await deleteStagedObject({
                s3Client: staged.s3Client,
                s3Bucket: staged.s3Bucket,
                key: staged.key,
                projectId: PROJECT_ID,
              });
            }
          }
        },
        120_000,
      );
    });
  });

  describe("given a staged-payload header pointing off S3", () => {
    describe("when nlpgo receives the invoke", () => {
      /** @scenario "The engine refuses a staged-payload header pointing off S3" */
      it.skipIf(!runE2E)(
        "rejects a staged-payload header whose host is not an AWS S3 host",
        async () => {
          // SSRF guard: a tampered header pointing off-S3 must be refused before
          // any fetch, even though the rest of the request is well-formed.
          const res = await fetch(`${nlpgo!.baseUrl}/go/studio/execute_sync`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              [STAGED_PAYLOAD_HEADER]:
                "https://evil.example.com/staged.json?sig=x",
            },
            body: "",
          });
          expect(res.status).toBe(400);
        },
        60_000,
      );
    });
  });
});
