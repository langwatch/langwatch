import { describe, expect, it } from "vitest";
import type { RecentItem } from "~/server/home/types";
import { groupItemsByType } from "../RecentItemsSection";

describe("RecentItemsSection", () => {
  describe("groupItemsByType", () => {
    describe("when items have different types", () => {
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
      it("returns empty map", () => {
        const grouped = groupItemsByType([]);

        expect(grouped.size).toBe(0);
      });
    });

    describe("when all items are same type", () => {
      it("groups all under that type", () => {
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
});

