import { describe, expect, it } from "vitest";
import type { PipelineNode } from "@langwatch/ops-contract";
import {
  joinSubscriberHealth,
  type SubscriberMeta,
  subscriberPauseKey,
} from "../src/ops.subscriber-health";

const META: SubscriberMeta = {
  subscriberName: "graphTriggerActivity",
  pipelineName: "automations",
  aggregateType: "automation",
  eventTypes: ["automation.triggered", "automation.completed"],
};

function treeWith(
  pipeline: string,
  subscriber: string,
  counts: { pending: number; active: number; blocked: number },
): PipelineNode[] {
  return [
    {
      name: pipeline,
      pending: counts.pending,
      active: counts.active,
      blocked: counts.blocked,
      children: [
        {
          name: "subscriber",
          ...counts,
          children: [{ name: subscriber, ...counts, children: [] }],
        },
      ],
    },
  ];
}

describe("joinSubscriberHealth", () => {
  describe("given a registered subscriber with no live queue activity", () => {
    /** @scenario "Every registered subscriber is listed, idle or not" */
    it("still lists it with zero counts and no live presence", () => {
      const rows = joinSubscriberHealth({
        subscribers: [META],
        pipelineTree: [],
        pausedKeys: [],
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        subscriberName: "graphTriggerActivity",
        pending: 0,
        active: 0,
        blocked: 0,
        hasLiveNode: false,
        isPaused: false,
      });
    });
  });

  describe("given a subscriber with pending and blocked groups in the live tree", () => {
    /** @scenario "A subscriber's live backlog joins its registry row" */
    it("carries the tree's counts onto the registry row", () => {
      const rows = joinSubscriberHealth({
        subscribers: [META],
        pipelineTree: treeWith("automations", "graphTriggerActivity", {
          pending: 41,
          active: 2,
          blocked: 3,
        }),
        pausedKeys: [],
      });
      expect(rows[0]).toMatchObject({
        pending: 41,
        active: 2,
        blocked: 3,
        hasLiveNode: true,
      });
    });

    it("does not borrow counts from an identically named subscriber in another pipeline", () => {
      const rows = joinSubscriberHealth({
        subscribers: [META],
        pipelineTree: treeWith("otherPipeline", "graphTriggerActivity", {
          pending: 99,
          active: 9,
          blocked: 9,
        }),
        pausedKeys: [],
      });
      expect(rows[0]?.pending).toBe(0);
      expect(rows[0]?.hasLiveNode).toBe(false);
    });
  });

  describe("given paused subscribers", () => {
    /** @scenario "A paused subscriber says so" */
    it("reads as paused for a direct pause and for a pipeline-level pause", () => {
      const direct = joinSubscriberHealth({
        subscribers: [META],
        pipelineTree: [],
        pausedKeys: ["automations/subscriber/graphTriggerActivity"],
      });
      expect(direct[0]?.isPaused).toBe(true);

      const viaPipeline = joinSubscriberHealth({
        subscribers: [META],
        pipelineTree: [],
        pausedKeys: ["automations"],
      });
      expect(viaPipeline[0]?.isPaused).toBe(true);
    });
  });

  it("sorts blocked and backlogged subscribers first", () => {
    const quiet = { ...META, subscriberName: "aQuiet" };
    const blocked = { ...META, subscriberName: "zBlocked" };
    const rows = joinSubscriberHealth({
      subscribers: [quiet, blocked],
      pipelineTree: treeWith("automations", "zBlocked", {
        pending: 1,
        active: 0,
        blocked: 2,
      }),
      pausedKeys: [],
    });
    expect(rows.map((r) => r.subscriberName)).toEqual(["zBlocked", "aQuiet"]);
  });
});

describe("subscriberPauseKey", () => {
  describe("given a subscriber row", () => {
    /** @scenario "Pausing a subscriber targets its queue path" */
    it("follows the queue's pipeline/subscriber/name path grammar", () => {
      expect(
        subscriberPauseKey({
          pipelineName: "automations",
          subscriberName: "graphTriggerActivity",
        }),
      ).toBe("automations/subscriber/graphTriggerActivity");
    });
  });
});
