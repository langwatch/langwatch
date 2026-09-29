/** Spec: specs/studio/nlp-lambda-cleanup.feature */
import { intentAccessorOf } from "@langwatch/eventing/testing";
import { describe, expect, it, vi } from "vitest";

import { workflowServer } from "../../workflow.server.ts";
import {
  NLP_LAMBDA_CLEANUP_PIPELINE_NAME,
  buildNlpLambdaCleanupPipeline,
} from "../workflow-nlp-lambda-cleanup.pipeline.ts";
import {
  NLP_LAMBDA_CLEANUP_INTERVAL_MS,
  NLP_LAMBDA_CLEANUP_PROCESS_NAME,
  nlpLambdaCleanupWake,
} from "../workflow-nlp-lambda-cleanup.process.ts";

const NOW = Date.parse("2026-09-29T03:00:00Z");

function built(sweep: () => Promise<void>) {
  const definition = buildNlpLambdaCleanupPipeline({
    sweep,
    deleteDispatchedBefore: async () => 0,
  });
  const process = definition.processManagers.get(NLP_LAMBDA_CLEANUP_PROCESS_NAME);
  if (!process) throw new Error("the declaration built no Lambda cleanup process manager");
  return { definition, process };
}

function wake(at: number) {
  return nlpLambdaCleanupWake(
    { lastSweepAt: null },
    {
      at,
      now: at,
      key: NLP_LAMBDA_CLEANUP_PROCESS_NAME,
      projectId: "__global__",
      intent: intentAccessorOf({
        sweep: (messageKey, payload) => ({ messageKey, intentType: "sweep", payload }),
      }),
    },
  );
}

async function deliver(process: ReturnType<typeof built>["process"], at: number) {
  await process.config.intents!.sweep!.run(
    { scheduledFor: at },
    {
      processName: NLP_LAMBDA_CLEANUP_PROCESS_NAME,
      projectId: "global",
      processKey: "global",
      tenantId: "global",
      messageKey: `sweep:${at}`,
      attempt: 1,
    },
  );
}

describe("given workflow's Lambda cleanup declaration", () => {
  /** @scenario "The daily wake asks for one sweep" */
  it("is installed with the module and wakes once a day", () => {
    const { definition, process } = built(async () => undefined);

    expect(workflowServer.eventing?.pipeline.split(", ")).toContain(
      NLP_LAMBDA_CLEANUP_PIPELINE_NAME,
    );
    expect(definition.metadata.name).toBe(NLP_LAMBDA_CLEANUP_PIPELINE_NAME);
    expect(process.config.schedule?.everyMs).toBe(NLP_LAMBDA_CLEANUP_INTERVAL_MS);
    expect(process.config.eventTypes).toEqual([]);
  });

  /** @scenario "The daily wake asks for one sweep" */
  it("asks for one sweep per wake, keyed by the wake", () => {
    expect(wake(NOW)).toEqual({
      state: { lastSweepAt: NOW },
      intents: [
        { messageKey: `sweep:${NOW}`, intentType: "sweep", payload: { scheduledFor: NOW } },
      ],
    });
  });

  describe("when the sweep cannot reach the account", () => {
    /** @scenario "A failed sweep fails its intent and the next wake asks again" */
    it("fails the intent, and the next wake asks for a fresh sweep", async () => {
      const sweep = vi.fn(async () => {
        throw new Error("AccessDenied");
      });
      const { process } = built(sweep);

      await expect(deliver(process, NOW)).rejects.toThrow("AccessDenied");

      const next = NOW + NLP_LAMBDA_CLEANUP_INTERVAL_MS;
      expect(wake(next).intents).toEqual([
        { messageKey: `sweep:${next}`, intentType: "sweep", payload: { scheduledFor: next } },
      ]);
    });
  });
});
