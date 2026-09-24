import { LangevalsPiiDetectionError } from "@langwatch/evaluation-contract";
import { describe, expect, it } from "vitest";

import { MemoryLangevalsChannel } from "../../channels/memory/memory.langevals.channel.ts";
import { LangevalsPiiDetectionService } from "../langevals-pii-detection.service.ts";

const ENDPOINT = "https://langevals.example";

const PROCESSED = {
  status: "processed",
  raw_response: { anonymized: "call <PHONE_NUMBER>" },
} as const;
const SKIPPED = { status: "skipped", details: "nothing found" } as const;

function setup(endpoint: string | undefined) {
  const langevals = MemoryLangevalsChannel.create();
  return { langevals, service: LangevalsPiiDetectionService.create({ endpoint, langevals }) };
}

function request(texts: string[]) {
  return {
    projectId: "project-1",
    texts,
    entities: ["PHONE_NUMBER", "EMAIL_ADDRESS"],
    signal: new AbortController().signal,
  };
}

describe("LangevalsPiiDetectionService", () => {
  describe("given no langevals endpoint", () => {
    /** @scenario "PII detection sends nothing when the deployment names no langevals endpoint" */
    it("answers not configured without posting", async () => {
      const { langevals, service } = setup(undefined);

      await expect(service.detect(request(["call 555-0100"]))).resolves.toEqual({
        kind: "not_configured",
      });
      expect(langevals.posts).toHaveLength(0);
    });
  });

  describe("given a langevals endpoint", () => {
    /** @scenario "PII detection posts a batch to langevals' Presidio evaluator and returns one result per text" */
    it("posts main's Presidio body and returns the results in order", async () => {
      const { langevals, service } = setup(ENDPOINT);
      langevals.answerWith(Response.json([PROCESSED, SKIPPED]));
      const input = request(["call 555-0100", "hello"]);

      const outcome = await service.detect(input);

      expect(outcome).toEqual({ kind: "detected", results: [PROCESSED, SKIPPED] });
      expect(langevals.posts).toEqual([
        {
          url: `${ENDPOINT}/presidio/pii_detection/evaluate`,
          body: {
            data: [{ input: "call 555-0100" }, { input: "hello" }],
            settings: { entities: { phone_number: true, email_address: true }, min_threshold: 0.5 },
            env: {},
          },
          projectId: "project-1",
          kind: "evaluation",
          signal: input.signal,
        },
      ]);
    });

    /** @scenario "An empty PII batch reaches no langevals" */
    it("answers an empty batch without posting", async () => {
      const { langevals, service } = setup(ENDPOINT);

      await expect(service.detect(request([]))).resolves.toEqual({ kind: "detected", results: [] });
      expect(langevals.posts).toHaveLength(0);
    });

    /** @scenario "A langevals PII detection failure is refused with the answer's body" */
    it("refuses a non-2xx answer carrying its body", async () => {
      const { langevals, service } = setup(ENDPOINT);
      langevals.answerWith(new Response("presidio exploded", { status: 500 }));

      const refusal = service.detect(request(["call 555-0100"]));

      await expect(refusal).rejects.toBeInstanceOf(LangevalsPiiDetectionError);
      await expect(refusal).rejects.toThrow("presidio exploded");
    });

    /** @scenario "A PII answer that is not one result per text is refused" */
    it("refuses an answer with the wrong number of results", async () => {
      const { langevals, service } = setup(ENDPOINT);
      langevals.answerWith(Response.json([PROCESSED]));

      await expect(service.detect(request(["a", "b"]))).rejects.toThrow(
        "Unexpected batch response: expected 2 results, got 1",
      );
    });
  });
});
