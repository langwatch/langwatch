/**
 * @vitest-environment jsdom
 * The home composes recent items from audit-log's touches and each owner's own list read.
 * Spec: specs/home/recent-items-backend.feature
 */
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

type Answer = { data?: unknown; isLoading?: boolean; error?: Error | null };
type Asked = { path: string; input: unknown; enabled: boolean };

const answers = new Map<string, Answer>();
const asked: Asked[] = [];
const refetch = vi.fn();

function procedure(path: string) {
  return {
    useQuery: (input: unknown, options: { enabled?: boolean }) => {
      const enabled = options.enabled !== false;
      asked.push({ path, input, enabled });
      if (!enabled) return { data: undefined, isLoading: false, error: null, refetch };
      const answer = answers.get(path) ?? {};
      return {
        data: answer.data,
        isLoading: answer.isLoading ?? false,
        error: answer.error ?? null,
        refetch,
      };
    },
  };
}

vi.mock("../home-api.ts", () => ({ homeApi: { home: { getRecentItems: procedure("touches") } } }));
vi.mock("@langwatch/prompt-client", () => ({
  promptClient: { prompts: { getAllPromptsForProject: procedure("prompt") } },
}));
vi.mock("@langwatch/workflow-client", () => ({
  workflowClient: { workflow: { getAll: procedure("workflow") } },
}));
vi.mock("@langwatch/dataset-client", () => ({
  datasetClient: { dataset: { getAll: procedure("dataset") } },
}));
vi.mock("@langwatch/monitor-client", () => ({
  monitorClient: { monitors: { getAllForProject: procedure("evaluation") } },
}));
vi.mock("@langwatch/annotation-client", () => ({
  annotationClient: { annotation: { getQueues: procedure("annotation") } },
}));

import { useRecentItems } from "../use-recent-items.ts";

const AT = "2026-09-01T00:00:00.000Z";
const touch = (type: string, id: string) => ({ id, type, updatedAt: AT });

function render() {
  return renderHook(() =>
    useRecentItems({ projectId: "project-1", projectSlug: "my-project", limit: 12 }),
  ).result.current;
}

function enabledLists(): string[] {
  return asked
    .filter((query) => query.enabled && query.path !== "touches")
    .map((query) => query.path);
}

afterEach(() => {
  cleanup();
  answers.clear();
  asked.length = 0;
});

describe("useRecentItems", () => {
  describe("given touches of a workflow and an annotation queue", () => {
    it("asks only those two owners' lists, for the project", () => {
      answers.set("touches", { data: [touch("workflow", "wf"), touch("annotation", "q")] });

      render();

      expect(enabledLists().toSorted()).toEqual(["annotation", "workflow"]);
      expect(asked.find((query) => query.path === "workflow")?.input).toEqual({
        projectId: "project-1",
      });
    });
  });

  describe("given every owner answers its rows", () => {
    /** @scenario "Hydrates items with entity name and updatedAt" */
    it("names and links each touch in touch order", () => {
      answers.set("touches", {
        data: [touch("workflow", "wf"), touch("annotation", "q"), touch("evaluation", "m")],
      });
      answers.set("workflow", { data: [{ id: "wf", name: "Test Workflow", extra: 1 }] });
      answers.set("annotation", { data: [{ id: "q", name: "Queue", slug: "queue" }] });
      answers.set("evaluation", { data: [{ id: "m", name: "Monitor" }] });

      const { data, isLoading } = render();

      expect(isLoading).toBe(false);
      expect(data).toEqual([
        {
          id: "wf",
          type: "workflow",
          updatedAt: AT,
          name: "Test Workflow",
          href: "/my-project/studio/wf",
        },
        {
          id: "q",
          type: "annotation",
          updatedAt: AT,
          name: "Queue",
          href: "/my-project/annotations/queue",
        },
        {
          id: "m",
          type: "evaluation",
          updatedAt: AT,
          name: "Monitor",
          href: "/my-project/online-evaluations",
        },
      ]);
    });
  });

  describe("given an owner list leaves the touched entity out", () => {
    /** @scenario "Excludes archived workflows from results" */
    it("drops that touch, as the list leaves archived and deleted rows out", () => {
      answers.set("touches", { data: [touch("workflow", "archived"), touch("prompt", "p")] });
      answers.set("workflow", { data: [] });
      answers.set("prompt", { data: [{ id: "p", name: "Live prompt" }] });

      expect(render().data?.map((item) => item.id)).toEqual(["p"]);
    });
  });

  describe("given the member may not read one owner's list", () => {
    it("drops that owner's rows and keeps the rest", () => {
      answers.set("touches", { data: [touch("dataset", "ds"), touch("prompt", "p")] });
      answers.set("dataset", { error: new Error("forbidden") });
      answers.set("prompt", { data: [{ id: "p", name: "Prompt" }] });

      const { data, error } = render();

      expect(data?.map((item) => item.id)).toEqual(["p"]);
      expect(error).toBeNull();
    });
  });

  describe("given an owner list is still loading", () => {
    it("holds the strip in loading until it settles", () => {
      answers.set("touches", { data: [touch("dataset", "ds"), touch("prompt", "p")] });
      answers.set("dataset", { isLoading: true });
      answers.set("prompt", { data: [{ id: "p", name: "Prompt" }] });

      const { data, isLoading } = render();

      expect(isLoading).toBe(true);
      expect(data).toBeUndefined();
    });
  });

  describe("given the touches fail", () => {
    it("reports the failure and asks no owner", () => {
      const failure = new Error("touches failed");
      answers.set("touches", { error: failure });

      const { data, error } = render();

      expect(error).toBe(failure);
      expect(data).toBeUndefined();
      expect(enabledLists()).toEqual([]);
    });
  });
});
