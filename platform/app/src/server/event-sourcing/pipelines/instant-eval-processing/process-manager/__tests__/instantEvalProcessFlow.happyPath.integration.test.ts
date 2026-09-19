/**
 * The plan-to-finish path of a run, driven through the process store, the
 * manager and the outbox dispatcher against the topology the pipeline mounts.
 *
 * Needs no datastore: the process store is in memory and the domain port is a
 * fake, which is what lets the loop itself be asserted rather than the
 * behaviour of a classifier.
 *
 * @see ../../pipeline.ts
 * @see ../../../../../../../specs/instant-evals/instant-eval-pipeline.feature
 */

import { describe, expect, it, vi } from "vitest";

import {
  harness,
  key,
  PROJECT_ID,
  pageJudged,
  planned,
  REF,
  RUN_ID,
  requested,
  toEnvelope,
} from "./instantEvalProcessFlowHarness";

describe("given a requested run", () => {
  describe("when the request is handled and its intent dispatched", () => {
    /** @scenario "A requested run is planned, judged page by page, and finished" */
    it("plans the run and records the plan", async () => {
      const { manager, dispatcher, commands } = harness();

      const first = await manager.handleEvent({
        envelope: toEnvelope(requested),
        now: 10_000,
      });
      expect(first.outcome).toBe("committed");

      const report = await dispatcher.runOnce({ now: 10_001 });

      expect(report.dispatched).toHaveLength(1);
      expect(commands.calls.recordPlanned).toEqual([
        {
          tenantId: PROJECT_ID,
          occurredAt: 999_999,
          runId: RUN_ID,
          total: 1_200,
          pageSize: 500,
          isCapped: false,
          keyColumns: ["ThreadId"],
        },
      ]);
    });
  });

  describe("when the plan lands", () => {
    /** @scenario "A requested run is planned, judged page by page, and finished" */
    it("judges page one", async () => {
      const { manager, dispatcher, store, port } = harness();

      await manager.handleEvent({
        envelope: toEnvelope(requested),
        now: 10_000,
      });
      await manager.handleEvent({
        envelope: toEnvelope(planned()),
        now: 11_000,
      });

      const pending = (await store.findMessagesByRef({ ref: REF })).filter(
        (message) => message.status === "pending",
      );
      expect(pending.map((message) => message.messageKey)).toContain(
        key(`page:${RUN_ID}:1`),
      );

      await dispatcher.runOnce({ now: 11_001 });
      expect(port.judgePage).toHaveBeenCalledWith(
        expect.objectContaining({ page: 1, afterTraceId: null, pageSize: 500 }),
      );
    });

    /** @scenario "A page judges under a deadline inside its lease" */
    it("hands the page the instant its lease lapses", async () => {
      const { manager, dispatcher, port } = harness();

      await manager.handleEvent({
        envelope: toEnvelope(requested),
        now: 10_000,
      });
      await manager.handleEvent({
        envelope: toEnvelope(planned()),
        now: 11_000,
      });

      await dispatcher.runOnce({ now: 11_001 });

      const input = (port.judgePage as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[0] as { deadlineAt: number | null };
      // The dispatcher's default lease is thirty seconds from the drain.
      expect(input.deadlineAt).toBe(11_001 + 30_000);
    });
  });

  describe("when a page reports more to do", () => {
    /** @scenario "A requested run is planned, judged page by page, and finished" */
    it("asks for the next page from the cursor it ended on", async () => {
      const { manager, store } = harness();

      await manager.handleEvent({
        envelope: toEnvelope(requested),
        now: 10_000,
      });
      await manager.handleEvent({
        envelope: toEnvelope(planned()),
        now: 11_000,
      });
      await manager.handleEvent({
        envelope: toEnvelope(pageJudged({ page: 1 })),
        now: 12_000,
      });

      const pending = (await store.findMessagesByRef({ ref: REF })).filter(
        (message) => message.status === "pending",
      );
      const next = pending.find(
        (message) => message.messageKey === key(`page:${RUN_ID}:2`),
      );
      expect(next?.payload).toMatchObject({
        page: 2,
        afterTraceId: "t500",
        remaining: 700,
      });
    });
  });

  describe("when the last page reports back", () => {
    /** @scenario "A requested run is planned, judged page by page, and finished" */
    it("finishes the run with what it spent", async () => {
      const { manager, dispatcher, commands } = harness();

      await manager.handleEvent({
        envelope: toEnvelope(requested),
        now: 10_000,
      });
      await manager.handleEvent({
        envelope: toEnvelope(planned()),
        now: 11_000,
      });
      await manager.handleEvent({
        envelope: toEnvelope(
          pageJudged({ page: 1, rows: 1_200, hasNextPage: false }),
        ),
        now: 12_000,
      });
      await dispatcher.runOnce({ now: 12_001 });
      await dispatcher.runOnce({ now: 12_002 });

      expect(commands.calls.recordFinished).toEqual([
        expect.objectContaining({
          runId: RUN_ID,
          outcome: "finished",
          errorCode: null,
          inputTokens: 900,
          requests: 500,
          costUsd: 0.1,
          priceUsd: 0.13,
        }),
      ]);
    });
  });
});

describe("given a statement with two rows per trace", () => {
  describe("when the run is driven to its end", () => {
    /** @scenario "A run over several rows per trace judges every row" */
    it("carries the span half of the cursor into the next page", async () => {
      // Two spans per trace, so a page of four rows covers two traces and the
      // boundary falls inside a trace. The cursor the page reports has to name
      // the span as well, or the next page starting at `TraceId > t2` would
      // skip t2's remaining spans entirely.
      const { manager, store } = harness({
        plan: vi.fn(async () => ({
          total: 8,
          pageSize: 4,
          isCapped: false,
          keyColumns: ["SpanId"],
        })),
      });

      await manager.handleEvent({
        envelope: toEnvelope(requested),
        now: 10_000,
      });
      await manager.handleEvent({
        envelope: toEnvelope(
          planned({ total: 8, pageSize: 4, keyColumns: ["SpanId"] }),
        ),
        now: 11_000,
      });
      await manager.handleEvent({
        envelope: toEnvelope(
          pageJudged({
            page: 1,
            rows: 4,
            cursor: "t2",
            cursorSpanId: "s1",
            hasNextPage: true,
          }),
        ),
        now: 12_000,
      });

      const pending = (await store.findMessagesByRef({ ref: REF })).filter(
        (message) => message.status === "pending",
      );
      const next = pending.find(
        (message) => message.messageKey === key(`page:${RUN_ID}:2`),
      );
      expect(next?.payload).toMatchObject({
        page: 2,
        afterTraceId: "t2",
        afterSpanId: "s1",
      });

      const instance = await store.findByRef({ ref: REF });
      expect(instance?.state).toMatchObject({
        cursor: "t2",
        cursorSpanId: "s1",
      });
    });
  });
});
