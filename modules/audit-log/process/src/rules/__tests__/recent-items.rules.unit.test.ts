import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import type { RecentTouch } from "../../repositories/recent-touch.repository.ts";
import { deriveRecentItemHref, pickRecentEntities } from "../recent-items.rules.ts";

function touch(action: string, args: RecentTouch["args"], second: number): RecentTouch {
  return { action, args, createdAt: Temporal.Instant.fromEpochMilliseconds(second * 1000) };
}

describe("pickRecentEntities", () => {
  describe("given a trail touching the same entity twice", () => {
    it("keeps the newest touch once, in trail order", () => {
      const entities = pickRecentEntities({
        touches: [
          touch("workflow.update", { workflowId: "wf-1" }, 3),
          touch("prompts.update", { configId: "prompt-1" }, 2),
          touch("workflow.create", { workflowId: "wf-1" }, 1),
        ],
        limit: 12,
      });

      expect(entities.map(({ type, id }) => ({ type, id }))).toEqual([
        { type: "workflow", id: "wf-1" },
        { type: "prompt", id: "prompt-1" },
      ]);
      expect(entities[0]?.touchedAt.epochMilliseconds).toBe(3000);
    });
  });

  describe("given each action family", () => {
    /** @scenario "Extracts prompt IDs from prompts.create actions" */
    /** @scenario "Extracts workflow IDs from workflow.create actions" */
    /** @scenario "Extracts dataset IDs from dataset.create actions" */
    it("reads the entity id from the argument main read it from", () => {
      const entities = pickRecentEntities({
        touches: [
          touch("prompts.create", { configId: "prompt-2" }, 10),
          touch("workflow.create", { workflowId: "wf-2" }, 9),
          touch("dataset.create", { datasetId: "ds-2" }, 8),
          touch("datasetRecord.update", { datasetId: "ds-1" }, 7),
          touch("monitors.update", { checkId: "check-1", monitorId: "ignored" }, 6),
          touch("monitors.toggle", { monitorId: "monitor-2" }, 5),
          touch("annotation.create", { annotationQueueId: "queue-1" }, 4),
          touch("scenarios.run", { scenarioSetId: "set-1" }, 3),
        ],
        limit: 12,
      });

      expect(entities.map(({ type, id }) => `${type}:${id}`)).toEqual([
        "prompt:prompt-2",
        "workflow:wf-2",
        "dataset:ds-2",
        "dataset:ds-1",
        "evaluation:check-1",
        "evaluation:monitor-2",
        "annotation:queue-1",
        "simulation:set-1",
      ]);
    });
  });

  describe("given touches outside the families or without an entity id", () => {
    it("skips them", () => {
      expect(
        pickRecentEntities({
          touches: [
            touch("project.update", { projectId: "p" }, 3),
            touch("workflow.update", { name: "no id" }, 2),
            touch("dataset.update", null, 1),
          ],
          limit: 12,
        }),
      ).toEqual([]);
    });
  });

  describe("given more entities than the strip holds", () => {
    /** @scenario "Limits results to requested count" */
    it("caps them at the limit", () => {
      const touches = [1, 2, 3].map((n) => touch("dataset.update", { datasetId: `ds-${n}` }, n));

      expect(pickRecentEntities({ touches, limit: 2 })).toHaveLength(2);
    });
  });
});

describe("deriveRecentItemHref", () => {
  it("links each entity type where main linked it", () => {
    const place = { projectSlug: "acme", id: "id-1" };

    expect(deriveRecentItemHref({ ...place, type: "prompt" })).toBe("/acme/prompts?prompt=id-1");
    expect(deriveRecentItemHref({ ...place, type: "workflow" })).toBe("/acme/studio/id-1");
    expect(deriveRecentItemHref({ ...place, type: "dataset" })).toBe("/acme/datasets/id-1");
    expect(deriveRecentItemHref({ ...place, type: "evaluation" })).toBe("/acme/online-evaluations");
    expect(deriveRecentItemHref({ ...place, type: "annotation", queueSlug: "review" })).toBe(
      "/acme/annotations/review",
    );
  });
});
