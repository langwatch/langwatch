/**
 * Ported from platform/app/src/components/home/__tests__/RecentItemsSection.test.ts
 * (origin/main); `groupItemsByType`'s own shape is unchanged by the move.
 * See specs/home/recent-items-ui.feature.
 */
import { describe, expect, it } from "vitest";
import type { RecentItem } from "../../../../behavior/home-api";
import { groupItemsByType } from "../recent-items-section";

describe("groupItemsByType", () => {
  describe("when items have different types", () => {
    /** @scenario By type tab groups items by entity type */
    it("groups items by their type", () => {
      const items: RecentItem[] = [
        {
          id: "1",
          type: "prompt",
          name: "Prompt 1",
          href: "/p/prompts?prompt=1",
          updatedAt: new Date(),
        },
        {
          id: "2",
          type: "workflow",
          name: "Workflow 1",
          href: "/p/studio/2",
          updatedAt: new Date(),
        },
        {
          id: "3",
          type: "prompt",
          name: "Prompt 2",
          href: "/p/prompts?prompt=3",
          updatedAt: new Date(),
        },
      ];

      const grouped = groupItemsByType(items);

      expect(grouped.get("prompt")).toHaveLength(2);
      expect(grouped.get("workflow")).toHaveLength(1);
    });
  });

  describe("when items list is empty", () => {
    it("returns an empty map", () => {
      const grouped = groupItemsByType([]);

      expect(grouped.size).toBe(0);
    });
  });

  describe("when all items are the same type", () => {
    it("groups all items under that type", () => {
      const items: RecentItem[] = [
        {
          id: "1",
          type: "dataset",
          name: "Dataset 1",
          href: "/p/datasets/1",
          updatedAt: new Date(),
        },
        {
          id: "2",
          type: "dataset",
          name: "Dataset 2",
          href: "/p/datasets/2",
          updatedAt: new Date(),
        },
      ];

      const grouped = groupItemsByType(items);

      expect(grouped.size).toBe(1);
      expect(grouped.get("dataset")).toHaveLength(2);
    });
  });
});
