/**
 * The registry enterprise ceiling is the outer validation shell: inputs above
 * it refuse at the schema, inputs at it parse. The tier-effective value is
 * enforced in the trace application, not here.
 */
import { describe, expect, it } from "vitest";
import { resolveRequestBound } from "@langwatch/plans";
import { traceFilterInputSchema, tracesTrpc } from "../traces.trpc.ts";

const ENTERPRISE_PAGE_SIZE = resolveRequestBound("tracesPageSizeMax", "ENTERPRISE");
const ENTERPRISE_IDS = resolveRequestBound("traceIdsMax", "ENTERPRISE");

const ids = (count: number) => Array.from({ length: count }, (_, index) => `trace-${index}`);

type TracesTrpcProcedure = keyof typeof tracesTrpc.members;

const isDeclared = (procedure: string): procedure is TracesTrpcProcedure =>
  Object.hasOwn(tracesTrpc.members, procedure);

const inputOf = (procedure: string) => {
  if (!isDeclared(procedure)) throw new Error(`tracesTrpc declares no procedure ${procedure}`);

  return tracesTrpc.members[procedure].input;
};

describe("traces request-bound schemas", () => {
  describe("given the pageSize field", () => {
    const filter = { projectId: "p1", startDate: 1_000, endDate: 2_000 };

    it("refuses a page size above the enterprise ceiling", () => {
      expect(
        traceFilterInputSchema.safeParse({ ...filter, pageSize: ENTERPRISE_PAGE_SIZE + 1 }).success,
      ).toBe(false);
    });

    it("accepts a page size at the enterprise ceiling", () => {
      expect(
        traceFilterInputSchema.safeParse({ ...filter, pageSize: ENTERPRISE_PAGE_SIZE }).success,
      ).toBe(true);
    });
  });

  it.each(["getEvaluationsMultiple", "getTracesWithSpans", "getFormattedSpansDigest"])(
    "refuses %s traceIds above the enterprise ceiling and accepts at it",
    (procedure) => {
      const input = inputOf(procedure);

      expect(input.safeParse({ projectId: "p1", traceIds: ids(ENTERPRISE_IDS + 1) }).success).toBe(
        false,
      );
      expect(input.safeParse({ projectId: "p1", traceIds: ids(ENTERPRISE_IDS) }).success).toBe(
        true,
      );
    },
  );

  it("refuses getTracesWithSpansByThreadIds threadIds above the enterprise ceiling", () => {
    const input = inputOf("getTracesWithSpansByThreadIds");

    expect(input.safeParse({ projectId: "p1", threadIds: ids(ENTERPRISE_IDS + 1) }).success).toBe(
      false,
    );
    expect(input.safeParse({ projectId: "p1", threadIds: ids(ENTERPRISE_IDS) }).success).toBe(true);
  });
});
