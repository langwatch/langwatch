/**
 * @see specs/home/recent-items-backend.feature
 */
import { describe, expect, it } from "vitest";

import {
  composeRecentItems,
  deriveRecentItemHref,
  recentItemTypesToResolve,
} from "../recent-item-composition.ts";

const touch = (
  type: "prompt" | "workflow" | "dataset" | "evaluation" | "annotation" | "simulation",
  id: string,
) => ({
  type,
  id,
  updatedAt: "2026-10-01T10:00:00.000Z",
});

describe("recentItemTypesToResolve", () => {
  describe("given touches of several types, simulations among them", () => {
    it("names each nameable type once and leaves simulations out", () => {
      const types = recentItemTypesToResolve({
        touches: [
          touch("prompt", "p1"),
          touch("prompt", "p2"),
          touch("simulation", "s1"),
          touch("dataset", "d1"),
        ],
      });

      expect([...types].toSorted()).toEqual(["dataset", "prompt"]);
    });
  });
});

describe("composeRecentItems", () => {
  describe("given touches the owners answer", () => {
    /** @scenario "Hydrates items with entity name and updatedAt" */
    it("names and links each in touch order, keeping the touch time", () => {
      const items = composeRecentItems({
        projectSlug: "acme",
        touches: [touch("dataset", "d1"), touch("prompt", "p1")],
        entities: {
          prompt: [{ id: "p1", name: "Greeter" }],
          dataset: [{ id: "d1", name: "Golden set" }],
        },
      });

      expect(items).toEqual([
        {
          type: "dataset",
          id: "d1",
          updatedAt: "2026-10-01T10:00:00.000Z",
          name: "Golden set",
          href: "/acme/datasets/d1",
        },
        {
          type: "prompt",
          id: "p1",
          updatedAt: "2026-10-01T10:00:00.000Z",
          name: "Greeter",
          href: "/acme/prompts?prompt=p1",
        },
      ]);
    });
  });

  describe("given a touch whose entity no owner list answers", () => {
    /** @scenario "Excludes soft-deleted prompts from results" */
    it("skips it, as a deleted or archived entity", () => {
      const items = composeRecentItems({
        projectSlug: "acme",
        touches: [touch("prompt", "gone"), touch("workflow", "w1")],
        entities: { prompt: [], workflow: [{ id: "w1", name: "Router" }] },
      });

      expect(items.map((item) => item.id)).toEqual(["w1"]);
    });
  });

  describe("given a simulation touch", () => {
    it("skips it", () => {
      const items = composeRecentItems({
        projectSlug: "acme",
        touches: [touch("simulation", "s1")],
        entities: {},
      });

      expect(items).toEqual([]);
    });
  });

  describe("given an annotation queue with a slug", () => {
    it("links by the queue slug", () => {
      const [item] = composeRecentItems({
        projectSlug: "acme",
        touches: [touch("annotation", "q1")],
        entities: { annotation: [{ id: "q1", name: "Review", slug: "review" }] },
      });

      expect(item?.href).toBe("/acme/annotations/review");
    });
  });
});

describe("deriveRecentItemHref", () => {
  it("links a workflow to the studio", () => {
    expect(deriveRecentItemHref({ type: "workflow", projectSlug: "acme", id: "w1" })).toBe(
      "/acme/studio/w1",
    );
  });

  it("links an evaluation to the online evaluations list", () => {
    expect(deriveRecentItemHref({ type: "evaluation", projectSlug: "acme", id: "m1" })).toBe(
      "/acme/online-evaluations",
    );
  });

  it("links an annotation queue without a slug by its id", () => {
    expect(deriveRecentItemHref({ type: "annotation", projectSlug: "acme", id: "q1" })).toBe(
      "/acme/annotations/q1",
    );
  });
});
