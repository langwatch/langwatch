/**
 * @vitest-environment jsdom
 * One step of the queue walk: asking for it, keeping the item left behind as a
 * placeholder, and never reading an unanswered or failed read as finished.
 * Spec: specs/ui/shared-scope-host.feature
 */

import { renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AnnotationHostProvider } from "../../model/annotation-host.ts";
import { StubAnnotationHost } from "../../testing.tsx";
import { useAnnotationQueueWalk } from "../use-annotation-queue-walk.ts";

type StepRead = {
  data?: Record<string, unknown>;
  isLoading: boolean;
  isError?: boolean;
  isPlaceholderData: boolean;
};

type StepCall = { input: Record<string, unknown>; options: Record<string, unknown> };

const mocks = vi.hoisted(() => {
  const read: StepRead = { isLoading: false, isPlaceholderData: false };
  const calls: StepCall[] = [];
  return { read, calls };
});

vi.mock("../annotation-api.ts", () => ({
  annotationApi: {
    annotation: {
      getQueueWalkStep: {
        useQuery: (input: Record<string, unknown>, options: Record<string, unknown>) => {
          mocks.calls.push({ input, options });
          return mocks.read;
        },
      },
    },
  },
}));

function renderWalk(queueItemId?: string, host = new StubAnnotationHost()) {
  return renderHook(() => useAnnotationQueueWalk({ queueItemId }), {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(AnnotationHostProvider, { value: host }, children),
  });
}

afterEach(() => {
  mocks.calls.length = 0;
  mocks.read = { isLoading: false, isPlaceholderData: false };
});

describe("given a reviewer reading an item of their queue", () => {
  describe("when the URL names an item", () => {
    it("reads that item in the project in scope", () => {
      renderWalk("item-2");

      expect(mocks.calls.at(-1)?.input).toEqual({ projectId: "proj-1", queueItemId: "item-2" });
      expect(mocks.calls.at(-1)?.options.enabled).toBe(true);
    });
  });

  describe("when they step on and the new read has not landed", () => {
    it("keeps the item they left, and says the step is stale", () => {
      const left = { item: { id: "item-1" }, position: 1, total: 3, queueFinished: false };
      mocks.read = { data: left, isLoading: false, isPlaceholderData: true };
      const { result } = renderWalk("item-2");

      const keepPrevious = mocks.calls.at(-1)?.options.placeholderData;
      expect(typeof keepPrevious === "function" && keepPrevious(left)).toBe(left);
      expect(result.current.item).toEqual({ id: "item-1" });
      expect(result.current.stepIsStale).toBe(true);
    });
  });

  describe("when nothing has answered yet", () => {
    it("reads as a queue still loading, never as a finished one", () => {
      mocks.read = { isLoading: true, isPlaceholderData: false };
      const { result } = renderWalk();

      expect(result.current.queueLoading).toBe(true);
      expect(result.current.queueFinished).toBe(false);
      expect(result.current.item).toBeNull();
      expect(result.current.position).toBe(0);
    });
  });

  describe("when no project is in scope", () => {
    it("does not read", () => {
      renderWalk(undefined, new StubAnnotationHost({ project: undefined }));

      expect(mocks.calls.at(-1)?.options.enabled).toBe(false);
    });
  });

  describe("when the active scope is still resolving", () => {
    /** @scenario "Annotation queue completion requires a successful read" */
    it("reads as loading although the disabled read is not, and never as finished", () => {
      const { result } = renderWalk(
        undefined,
        new StubAnnotationHost({ project: undefined, scopeStatus: "loading" }),
      );

      expect(result.current.queueLoading).toBe(true);
      expect(result.current.queueFinished).toBe(false);
      expect(result.current.scopeUnavailable).toBe(false);
    });
  });

  describe("when the queue read fails", () => {
    /** @scenario "Annotation queue completion requires a successful read" */
    it("reads as failed, never as finished", () => {
      mocks.read = { isLoading: false, isError: true, isPlaceholderData: false };
      const { result } = renderWalk();

      expect(result.current.queueFailed).toBe(true);
      expect(result.current.queueFinished).toBe(false);
    });
  });

  describe("when the active scope is unavailable", () => {
    /** @scenario "Annotation queue completion requires a successful read" */
    it("reads the scope as unavailable and does not read", () => {
      const { result } = renderWalk(
        undefined,
        new StubAnnotationHost({ project: undefined, scopeStatus: "unavailable" }),
      );

      expect(result.current.scopeUnavailable).toBe(true);
      expect(result.current.queueLoading).toBe(false);
      expect(mocks.calls.at(-1)?.options.enabled).toBe(false);
    });
  });
});
