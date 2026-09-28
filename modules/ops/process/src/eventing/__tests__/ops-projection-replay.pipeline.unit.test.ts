/** Spec: modules/ops/specs/projection-replay-console.feature */
import { createTenantId, InMemoryProcessStore } from "@langwatch/eventing";
import { intentAccessorOf } from "@langwatch/eventing/testing";
import { describe, expect, it, vi } from "vitest";

import { RequestProjectionReplayCommand } from "../ops-projection-replay.commands.ts";
import {
  PROJECTION_REPLAY_AGGREGATE_TYPE,
  PROJECTION_REPLAY_PIPELINE_NAME,
  type ProjectionReplayRun,
} from "../ops-projection-replay.events.ts";
import {
  buildProjectionReplay,
  projectionReplayEventing,
} from "../ops-projection-replay.pipeline.ts";
import {
  PROJECTION_REPLAY_PROCESS_NAME,
  onProjectionReplayRequested,
} from "../ops-projection-replay.process.ts";

const NOW = Date.parse("2026-09-28T12:00:00Z");

const run: ProjectionReplayRun = {
  runId: "replayrun_1",
  projectionNames: ["traceSummary"],
  since: "2026-09-01T00:00:00.000Z",
  tenantIds: [],
  description: "repair trace summaries",
  userName: "operator@example.com",
};

function built(executeReplay: (input: ProjectionReplayRun) => Promise<void>) {
  const definition = buildProjectionReplay({
    participation: "consume",
    repositories: undefined,
    app: { executeReplay },
    processStore: InMemoryProcessStore.createForTesting(),
  });
  const process = definition.processManagers.get(PROJECTION_REPLAY_PROCESS_NAME);
  if (!process) throw new Error("the declaration built no projection-replay process manager");
  return { definition, process };
}

function requested() {
  return onProjectionReplayRequested({ requestedAt: null }, run, {
    at: NOW,
    now: NOW,
    key: run.runId,
    projectId: "user_operator",
    intent: intentAccessorOf({
      execute: (messageKey, payload) => ({ messageKey, intentType: "execute", payload }),
    }),
  });
}

describe("given ops's projection-replay declaration", () => {
  /** @scenario "Starting a replay records it running and the worker executes it" */
  it("files the operator's request as one event on the run's aggregate", async () => {
    const command = new RequestProjectionReplayCommand();

    const events = await command.handle({
      tenantId: createTenantId("user_operator"),
      aggregateId: run.runId,
      type: "lw.ops.projection_replay.request",
      data: { ...run, tenantId: "user_operator", occurredAt: NOW },
    });

    expect(projectionReplayEventing.pipeline).toBe(PROJECTION_REPLAY_PIPELINE_NAME);
    expect(events).toEqual([
      expect.objectContaining({
        aggregateType: PROJECTION_REPLAY_AGGREGATE_TYPE,
        aggregateId: run.runId,
        tenantId: "user_operator",
        data: run,
      }),
    ]);
  });

  /** @scenario "Starting a replay records it running and the worker executes it" */
  it("asks for one execution per run, keyed by the run", () => {
    const evolution = requested();

    expect(evolution.intents).toEqual([
      expect.objectContaining({ messageKey: `execute:${run.runId}`, intentType: "execute" }),
    ]);
    expect(requested().intents?.[0]?.messageKey).toBe(evolution.intents?.[0]?.messageKey);
  });

  /** @scenario "Starting a replay records it running and the worker executes it" */
  it("runs the execution on the worker once, never retrying a lapsed delivery", async () => {
    const executeReplay = vi.fn<(input: ProjectionReplayRun) => Promise<void>>(() =>
      Promise.resolve(),
    );
    const { process } = built(executeReplay);

    await process.config.intents?.execute?.run(run, {
      processName: PROJECTION_REPLAY_PROCESS_NAME,
      projectId: "user_operator",
      processKey: run.runId,
      tenantId: "user_operator",
      messageKey: `execute:${run.runId}`,
      attempt: 1,
    });

    expect(executeReplay).toHaveBeenCalledWith(run);
    expect(process.config.outbox).toMatchObject({ maxAttempts: 1, concurrency: 1 });
  });
});
