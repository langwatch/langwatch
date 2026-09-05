/**
 * Whether a langevals request goes out inline or through a parked payload.
 *
 * Three branches matter: at or below the threshold the body is posted inline;
 * between the threshold and the per-kind cap it is parked and only a presigned
 * URL travels in the header; above the cap the call is refused before any
 * network happens at all.
 *
 * Staging arrives as a port, so the suite stands one up and reads what was
 * parked rather than mocking an object-storage SDK.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  LangevalsPayloadStagingPort,
  STAGED_PAYLOAD_HEADER,
  type StagedLangevalsPayload,
} from "../../ports/langevals-payload-staging.port";
import {
  LangevalsStagedPayloadAdapter,
  PayloadTooLargeError,
  type LangevalsStagedPayloadConfig,
} from "../langevals-staged-payload.adapter";

type StagedCall = {
  projectId: string;
  keyPrefix: string;
  bytes: number;
  ttlSeconds: number;
};

class RecordingStaging extends LangevalsPayloadStagingPort {
  readonly staged: StagedCall[] = [];
  readonly discarded: string[] = [];

  async stage(input: {
    projectId: string;
    keyPrefix: string;
    serialized: Buffer;
    ttlSeconds: number;
  }): Promise<StagedLangevalsPayload> {
    const key = `${input.keyPrefix}/${this.staged.length}.json`;
    this.staged.push({
      projectId: input.projectId,
      keyPrefix: input.keyPrefix,
      bytes: input.serialized.byteLength,
      ttlSeconds: input.ttlSeconds,
    });
    const discarded = this.discarded;
    return {
      url: `https://storage.example/${encodeURIComponent(key)}?signed=yes&expires=${input.ttlSeconds}`,
      discard: async () => {
        discarded.push(key);
      },
    };
  }
}

const CONFIG: LangevalsStagedPayloadConfig = {
  stagingThresholdBytes: 1_000,
  stagingTtlSeconds: 600,
  evaluationMaxPayloadBytes: 5_000,
  topicClusteringMaxPayloadBytes: 50_000,
};

const fetchCalls: { url: string; init: RequestInit | undefined }[] = [];

const headersOf = (index: number) =>
  (fetchCalls[index]?.init?.headers ?? {}) as Record<string, string>;

beforeEach(() => {
  fetchCalls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      fetchCalls.push({ url, init });
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
});

describe("given a deployment that parks payloads over a threshold", () => {
  const adapterWith = (staging: RecordingStaging) =>
    LangevalsStagedPayloadAdapter.create({ config: CONFIG, staging });

  describe("when the body is below the staging threshold", () => {
    /** @scenario "Small eval payload posts inline" */
    it("posts the body itself, and parks nothing", async () => {
      const staging = new RecordingStaging();

      await adapterWith(staging).post({
        url: "https://langevals.test/openai/factuality/evaluate",
        body: { small: "payload" },
        projectId: "project_unit_a",
        kind: "evaluation",
      });

      expect(staging.staged).toHaveLength(0);
      expect(fetchCalls).toHaveLength(1);
      const init = fetchCalls[0]!.init!;
      expect(init.method).toBe("POST");
      expect((init.body as Buffer).toString("utf-8")).toBe(JSON.stringify({ small: "payload" }));
      expect(headersOf(0)["Content-Type"]).toBe("application/json");
      expect(headersOf(0)[STAGED_PAYLOAD_HEADER]).toBeUndefined();
    });
  });

  describe("when the body is over the threshold but under the cap", () => {
    /** @scenario "Large topic clustering payload stages via presigned URL" */
    it("parks the body and sends only the presigned URL", async () => {
      const staging = new RecordingStaging();

      await adapterWith(staging).post({
        url: "https://langevals.test/topics/batch_clustering",
        body: { traces: "x".repeat(2_000) },
        projectId: "project_unit_b",
        kind: "topic_clustering_batch",
      });

      expect(staging.staged).toHaveLength(1);
      expect(staging.staged[0]!.keyPrefix).toBe(
        "langevals-staging/project_unit_b/topic_clustering_batch",
      );
      expect(staging.staged[0]!.ttlSeconds).toBe(600);

      expect(fetchCalls).toHaveLength(1);
      expect(fetchCalls[0]!.init!.body).toBeUndefined();
      expect(headersOf(0)[STAGED_PAYLOAD_HEADER]).toContain("https://storage.example/");
      expect(headersOf(0)[STAGED_PAYLOAD_HEADER]).toContain("signed=yes");
    });

    /** @scenario "Staged S3 object is deleted after the upstream responds" */
    it("discards exactly the object it parked once the upstream has answered", async () => {
      const staging = new RecordingStaging();

      await adapterWith(staging).post({
        url: "https://langevals.test/topics/batch_clustering",
        body: { traces: "x".repeat(2_000) },
        projectId: "project_unit_cleanup",
        kind: "topic_clustering_batch",
      });

      expect(staging.discarded).toEqual([
        "langevals-staging/project_unit_cleanup/topic_clustering_batch/0.json",
      ]);
    });
  });

  describe("when the body is over the kind's hard cap", () => {
    /** @scenario "Eval payload above the eval hard cap is rejected before any network call" */
    it("refuses before anything is parked or sent", async () => {
      const staging = new RecordingStaging();

      await expect(
        adapterWith(staging).post({
          url: "https://langevals.test/openai/factuality/evaluate",
          body: { traces: "x".repeat(6_000) },
          projectId: "project_unit_c",
          kind: "evaluation",
        }),
      ).rejects.toBeInstanceOf(PayloadTooLargeError);

      expect(staging.staged).toHaveLength(0);
      expect(fetchCalls).toHaveLength(0);
    });

    /** @scenario "Topic clustering payload above the eval cap but below the clustering cap stages successfully" */
    it("measures topic clustering against its own, higher cap", async () => {
      const staging = new RecordingStaging();

      await expect(
        adapterWith(staging).post({
          url: "https://langevals.test/topics/batch_clustering",
          body: { traces: "x".repeat(6_000) },
          projectId: "project_unit_d",
          kind: "topic_clustering_batch",
        }),
      ).resolves.toBeInstanceOf(Response);

      expect(staging.staged).toHaveLength(1);
    });
  });
});

describe("given a deployment that configured no staging threshold", () => {
  describe("when a payload far over the threshold is posted", () => {
    /** @scenario "Self-hosted langevals never stages regardless of payload size" */
    it("posts it inline, because there is no synchronous body cap to dodge", async () => {
      const staging = new RecordingStaging();
      const adapter = LangevalsStagedPayloadAdapter.create({
        config: {
          stagingThresholdBytes: undefined,
          stagingTtlSeconds: 600,
          evaluationMaxPayloadBytes: 50_000,
          topicClusteringMaxPayloadBytes: 500_000,
        },
        staging,
      });

      await adapter.post({
        url: "https://langevals.test/topics/batch_clustering",
        body: { traces: "x".repeat(20_000) },
        projectId: "project_unit_e",
        kind: "topic_clustering_batch",
      });

      expect(staging.staged).toHaveLength(0);
      expect(fetchCalls).toHaveLength(1);
      expect(headersOf(0)[STAGED_PAYLOAD_HEADER]).toBeUndefined();
    });
  });
});
