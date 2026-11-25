/** Spec: modules/ops/specs/queue-stranded-groups.feature */
import { InMemoryProcessStore } from "@langwatch/eventing";
import { intentAccessorOf } from "@langwatch/eventing/testing";
import { describe, expect, it, vi } from "vitest";

import { opsProcessModule } from "../../ops.module.ts";
import { GROUP_QUEUE_REAPER_PROCESS_NAME } from "../ops-group-queue-reaper.intent.ts";
import {
  GROUP_QUEUE_REAPER_PIPELINE_NAME,
  buildGroupQueueReaper,
  groupQueueReaperEventing,
} from "../ops-group-queue-reaper.pipeline.ts";
import { groupQueueReaperWake } from "../ops-group-queue-reaper.process.ts";

const NOW = Date.parse("2026-10-09T12:00:00Z");
const HOUR = 60 * 60 * 1000;
const NOTHING = {
  strandedGroups: 0,
  strandedJobs: 0,
  deletedGroups: 0,
  failedDeletes: 0,
  totalPendingNow: null,
};

function built(
  reapStrandedQueueGroups: (input: { requestedBy: string }) => Promise<typeof NOTHING>,
) {
  const processStore = InMemoryProcessStore.createForTesting();
  const definition = buildGroupQueueReaper({
    participation: "consume",
    repositories: undefined,
    app: { reapStrandedQueueGroups },
    processStore,
  });
  const process = definition.processManagers.get(GROUP_QUEUE_REAPER_PROCESS_NAME);
  if (!process) throw new Error("the declaration built no group-queue reaper process manager");
  return { definition, process };
}

async function deliver(process: ReturnType<typeof built>["process"], at: number) {
  await process.config.intents!.reap!.run(
    { scheduledFor: at },
    {
      processName: GROUP_QUEUE_REAPER_PROCESS_NAME,
      projectId: "global",
      processKey: "global",
      tenantId: "global",
      messageKey: `reap:${at}`,
      attempt: 1,
    },
  );
}

function wake(at: number) {
  return groupQueueReaperWake(
    { lastReapedAt: null },
    {
      at,
      now: at,
      key: GROUP_QUEUE_REAPER_PROCESS_NAME,
      projectId: "__global__",
      intent: intentAccessorOf({
        reap: (messageKey, payload) => ({ messageKey, intentType: "reap", payload }),
      }),
    },
  );
}

describe("given ops's group-queue reaper declaration", () => {
  /** @scenario "Stranded groups are reaped every hour as a scheduled process" */
  it("is installed with the module and wakes every hour", () => {
    const { definition, process } = built(async () => NOTHING);

    expect(groupQueueReaperEventing.pipeline).toBe(GROUP_QUEUE_REAPER_PIPELINE_NAME);
    expect(opsProcessModule.eventing?.pipeline.split(", ")).toContain(
      GROUP_QUEUE_REAPER_PIPELINE_NAME,
    );
    expect(definition.metadata.name).toBe(GROUP_QUEUE_REAPER_PIPELINE_NAME);
    expect(process.config.schedule?.everyMs).toBe(HOUR);
  });

  /** @scenario "Stranded groups are reaped every hour as a scheduled process" */
  it("asks for one reap per wake, keyed by the wake", () => {
    const first = wake(NOW);

    expect(first.intents).toHaveLength(1);
    expect(first.intents?.[0]?.messageKey).toBe(wake(NOW).intents?.[0]?.messageKey);
    expect(wake(NOW + HOUR).intents?.[0]?.messageKey).not.toBe(first.intents?.[0]?.messageKey);
  });

  /** @scenario "Stranded groups are reaped every hour as a scheduled process" */
  it("reaps through the module when the reap is delivered", async () => {
    const reap = vi.fn(async () => NOTHING);
    const { process } = built(reap);

    await deliver(process, NOW);

    expect(reap).toHaveBeenCalledWith({ requestedBy: GROUP_QUEUE_REAPER_PIPELINE_NAME });
  });

  /** @scenario "A failed scheduled reap waits for the next wake" */
  it("swallows a failed reap so the process does not fail", async () => {
    const { process } = built(async () => {
      throw new Error("ECONNREFUSED");
    });

    await expect(deliver(process, NOW)).resolves.toBeUndefined();
  });
});
