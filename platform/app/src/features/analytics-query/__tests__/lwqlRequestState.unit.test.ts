/**
 * The workbench's request machine: draft, submitted snapshot, outcome.
 *
 * Driven through the controller with a fake executor rather than through the
 * reducer alone, because half the rules the feature file states are about
 * whether a REQUEST is issued — a reducer assertion could only ever prove that
 * some state did not change.
 *
 * Spec: specs/analytics/lwql-workbench.feature
 */

import { describe, expect, it, vi } from "vitest";

import type { LangWatchQLQueryResult } from "~/server/analytics/lwql";

import {
  createLangWatchQLRequestController,
  type LangWatchQLExecuteRequest,
} from "../logic/lwqlRequestController";
import {
  lwqlActionLabel,
  isLangWatchQLResultStale,
} from "../logic/lwqlRequestState";

import { lwqlResult } from "./lwqlFixtures";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets every already-queued microtask run. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

interface Call {
  request: LangWatchQLExecuteRequest;
  signal: AbortSignal;
  deferred: Deferred<LangWatchQLQueryResult>;
}

function fakeExecutor() {
  const calls: Call[] = [];
  const execute = vi.fn(
    (
      request: LangWatchQLExecuteRequest,
      { signal }: { signal: AbortSignal },
    ) => {
      const pending = deferred<LangWatchQLQueryResult>();
      calls.push({ request, signal, deferred: pending });
      return pending.promise;
    },
  );
  return { calls, execute };
}

function controllerWith(draft: {
  sql: string;
  parameters?: Record<string, string | number | boolean | null>;
}) {
  const { calls, execute } = fakeExecutor();
  const controller = createLangWatchQLRequestController({
    execute,
    initialDraft: { sql: draft.sql, parameters: draft.parameters ?? {} },
  });
  return { calls, execute, controller };
}

describe("the LangWatchQL request machine", () => {
  describe("given a draft statement and parameters", () => {
    describe("when the member runs the query and it succeeds", () => {
      /** @scenario "Run query submits the draft and becomes Reload on success" */
      it("submits that exact draft and the action then reads Reload", async () => {
        const { calls, controller } = controllerWith({
          sql: "SELECT trace_id FROM analytics.traces_daily",
          parameters: { since: "2026-01-01" },
        });

        controller.runQuery();
        expect(calls).toHaveLength(1);
        expect(calls[0]!.request).toEqual({
          sql: "SELECT trace_id FROM analytics.traces_daily",
          parameters: { since: "2026-01-01" },
        });

        calls[0]!.deferred.resolve(lwqlResult());
        await settle();

        const state = controller.getState();
        expect(state.submitted).toEqual(state.draft);
        expect(state.outcome).toEqual({
          kind: "result",
          result: lwqlResult(),
          // The answer records the request that earned it, not "the last
          // request", so nothing downstream has to guess.
          snapshot: state.draft,
        });
        expect(lwqlActionLabel(state)).toBe("Reload");
        expect(isLangWatchQLResultStale(state)).toBe(false);
      });
    });

    describe("when the member edits the SQL after a successful result", () => {
      /** @scenario "Editing SQL or parameters marks the result stale and restores Run query" */
      it("marks the visible result stale and the action reads Run query again", async () => {
        const { calls, controller } = controllerWith({ sql: "SELECT 1" });

        controller.runQuery();
        calls[0]!.deferred.resolve(lwqlResult());
        await settle();

        controller.setSql("SELECT 2");

        const state = controller.getState();
        expect(isLangWatchQLResultStale(state)).toBe(true);
        expect(lwqlActionLabel(state)).toBe("Run query");
        // The result is still there to read; only its standing changed.
        expect(state.outcome?.kind).toBe("result");
      });
    });

    describe("when the member edits the parameters after a successful result", () => {
      /** @scenario "Editing SQL or parameters marks the result stale and restores Run query" */
      it("marks the visible result stale and the action reads Run query again", async () => {
        const { calls, controller } = controllerWith({
          sql: "SELECT 1",
          parameters: { since: "2026-01-01" },
        });

        controller.runQuery();
        calls[0]!.deferred.resolve(lwqlResult());
        await settle();

        controller.setParameters({ since: "2026-02-01" });

        const state = controller.getState();
        expect(isLangWatchQLResultStale(state)).toBe(true);
        expect(lwqlActionLabel(state)).toBe("Run query");
      });
    });

    describe("when the workbench is disposed before the second submission answers", () => {
      /** @scenario "A stale result stays labelled as belonging to the previous submission" */
      it("leaves the earlier result stale rather than crediting it to the abandoned request", async () => {
        const { calls, controller } = controllerWith({ sql: "SELECT 1" });

        controller.runQuery();
        calls[0]!.deferred.resolve(lwqlResult());
        await settle();

        controller.setSql("SELECT 2");
        controller.runQuery();
        controller.dispose();

        const state = controller.getState();
        // The LAST submission is the cancelled one, and it matches the draft.
        expect(state.submitted).toEqual({ sql: "SELECT 2", parameters: {} });
        expect(state.draft).toEqual({ sql: "SELECT 2", parameters: {} });
        // The visible result is still the first submission's, and says so —
        // which is the only thing that keeps it from reading as current.
        expect(state.outcome?.kind).toBe("result");
        expect(state.outcome?.snapshot).toEqual({
          sql: "SELECT 1",
          parameters: {},
        });
        expect(isLangWatchQLResultStale(state)).toBe(true);
        expect(lwqlActionLabel(state)).toBe("Run query");
      });
    });

    describe("when a later submission fails after an earlier one succeeded", () => {
      /** @scenario "Editing SQL or parameters marks the result stale and restores Run query" */
      it("replaces the visible result with the failure, credited to the request that failed", async () => {
        const { calls, controller } = controllerWith({ sql: "SELECT 1" });

        controller.runQuery();
        calls[0]!.deferred.resolve(lwqlResult());
        await settle();

        controller.setSql("SELECT 2");
        controller.runQuery();
        const refusal = {
          data: {
            error: { code: "lwql_not_permitted", httpStatus: 400 },
          },
        };
        calls[1]!.deferred.reject(refusal);
        await settle();

        const state = controller.getState();
        expect(state.outcome?.kind).toBe("error");
        expect(state.outcome?.snapshot).toEqual({
          sql: "SELECT 2",
          parameters: {},
        });
        // The failure answers the current draft, so nothing is stale and
        // nothing offers to reload the rows that are no longer on screen.
        expect(isLangWatchQLResultStale(state)).toBe(false);
        expect(lwqlActionLabel(state)).toBe("Run query");
      });
    });
  });

  describe("given a submitted snapshot the draft has moved away from", () => {
    describe("when the member reloads", () => {
      /** @scenario "Reload reruns the submitted snapshot exactly" */
      it("sends the submitted SQL and parameters, not the draft", async () => {
        const { calls, controller } = controllerWith({
          sql: "SELECT trace_id FROM analytics.traces_daily",
          parameters: { since: "2026-01-01" },
        });

        controller.runQuery();
        calls[0]!.deferred.resolve(lwqlResult());
        await settle();

        controller.setSql("SELECT something_else");
        controller.setParameters({ since: "2026-02-01" });

        controller.reload();

        expect(calls).toHaveLength(2);
        expect(calls[1]!.request).toEqual({
          sql: "SELECT trace_id FROM analytics.traces_daily",
          parameters: { since: "2026-01-01" },
        });
        // The draft is untouched by a reload.
        expect(controller.getState().draft).toEqual({
          sql: "SELECT something_else",
          parameters: { since: "2026-02-01" },
        });
      });
    });
  });

  describe("given a LangWatchQL query already in flight", () => {
    describe("when the member tries to run or reload again", () => {
      /** @scenario "Duplicate submissions are prevented while a request is in flight" */
      it("issues no second request until the first settles", async () => {
        const { calls, controller } = controllerWith({ sql: "SELECT 1" });

        controller.runQuery();
        expect(calls).toHaveLength(1);

        controller.runQuery();
        controller.reload();
        controller.setSql("SELECT 2");
        controller.runQuery();

        expect(calls).toHaveLength(1);

        calls[0]!.deferred.resolve(lwqlResult());
        await settle();

        controller.runQuery();
        expect(calls).toHaveLength(2);
      });
    });

    describe("when the member leaves the workbench", () => {
      /** @scenario "An aborted request never updates the result pane" */
      it("aborts the request and drops an answer that arrives afterwards", async () => {
        const { calls, controller } = controllerWith({ sql: "SELECT 1" });

        controller.runQuery();
        expect(calls[0]!.signal.aborted).toBe(false);

        controller.dispose();
        expect(calls[0]!.signal.aborted).toBe(true);

        calls[0]!.deferred.resolve(lwqlResult());
        await settle();

        expect(controller.getState().outcome).toBeNull();
        expect(controller.getState().isInFlight).toBe(false);
      });
    });

    describe("when the member cancels the run", () => {
      /** @scenario "Cancelling an in-flight run keeps the previous result" */
      it("abandons the request and keeps the previous result on screen", async () => {
        const { calls, controller } = controllerWith({ sql: "SELECT 1" });

        controller.runQuery();
        calls[0]!.deferred.resolve(lwqlResult());
        await settle();
        const shown = controller.getState().outcome;

        controller.setSql("SELECT 2");
        controller.runQuery();
        expect(controller.getState().isInFlight).toBe(true);

        controller.cancel();
        expect(calls[1]!.signal.aborted).toBe(true);
        expect(controller.getState().isInFlight).toBe(false);
        expect(controller.getState().outcome).toBe(shown);

        // An answer the transport delivers anyway is a superseded submission's
        // and changes nothing.
        calls[1]!.deferred.resolve(lwqlResult({ truncated: true }));
        await settle();
        expect(controller.getState().outcome).toBe(shown);

        // Cancelling is not disposal: the workbench still runs the next draft.
        controller.runQuery();
        expect(calls).toHaveLength(3);
      });

      it("is a no-op when nothing is in flight", () => {
        const { calls, controller } = controllerWith({ sql: "SELECT 1" });
        controller.cancel();
        expect(calls).toHaveLength(0);
        expect(controller.getState().isInFlight).toBe(false);
      });
    });

    describe("when a cancelled request rejects after the fact", () => {
      /** @scenario "An aborted request never updates the result pane" */
      it("leaves the previously visible result exactly as it was", async () => {
        const { calls, controller } = controllerWith({ sql: "SELECT 1" });

        controller.runQuery();
        calls[0]!.deferred.resolve(lwqlResult({ truncated: false }));
        await settle();
        const shown = controller.getState().outcome;

        controller.runQuery();
        controller.dispose();
        calls[1]!.deferred.reject(new Error("aborted"));
        await settle();

        expect(controller.getState().outcome).toBe(shown);
      });
    });
  });

  describe("given a draft whose SQL the backend would reject", () => {
    describe("when the member runs the query", () => {
      /** @scenario "The frontend does not implement a second SQL validator" */
      it("submits the statement unmodified and surfaces the backend's refusal", async () => {
        const rejected = "  DROP TABLE traces;;  SELECT 1 -- trailing\n";
        const { calls, controller } = controllerWith({ sql: rejected });

        controller.runQuery();

        // Byte for byte: no trim, no rewrite, no local opinion about it.
        expect(calls[0]!.request.sql).toBe(rejected);
        expect(calls[0]!.request.parameters).toBeUndefined();

        const refusal = {
          data: { error: { code: "lwql_not_permitted" } },
        };
        calls[0]!.deferred.reject(refusal);
        await settle();

        expect(controller.getState().outcome).toEqual({
          kind: "error",
          error: refusal,
          snapshot: { sql: rejected, parameters: {} },
        });
      });
    });
  });
});
