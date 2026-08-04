import { describe, expect, it, vi } from "vitest";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  billingMeterDispatchGroupKey,
  createBillingMeterDispatchReactor,
} from "../billingMeterDispatch.reactor";

/**
 * The lane and the dedup id must describe the same unit of work. The queue
 * only squashes a duplicate when the dedup key's existing job is found in the
 * group being staged into, so a per-project dedup id under a per-trace lane
 * never collapses anything — it leaves one live job per concurrent trace and
 * deletes the guard on the job already pending elsewhere.
 */
describe("billingMeterDispatchGroupKey", () => {
  describe("given two events for the same project", () => {
    describe("when they come from different traces", () => {
      it("routes them to the same lane", () => {
        expect(billingMeterDispatchGroupKey({ tenantId: "project_x" })).toBe(
          billingMeterDispatchGroupKey({ tenantId: "project_x" }),
        );
      });
    });
  });

  describe("given events for different projects", () => {
    it("routes them to different lanes", () => {
      expect(billingMeterDispatchGroupKey({ tenantId: "project_x" })).not.toBe(
        billingMeterDispatchGroupKey({ tenantId: "project_y" }),
      );
    });
  });

  it("keys the lane on the project alone", () => {
    expect(billingMeterDispatchGroupKey({ tenantId: "project_x" })).toBe(
      "billing-meter-dispatch:project_x",
    );
  });
});

describe("createBillingMeterDispatchReactor lane wiring", () => {
  const reactor = createBillingMeterDispatchReactor({
    getDispatch: () => async () => {},
  });

  function payloadFor({
    tenantId,
    aggregateId,
  }: {
    tenantId: string;
    aggregateId: string;
  }) {
    return {
      event: { tenantId, aggregateId, aggregateType: "trace" },
      foldState: {},
    } as unknown as Parameters<
      NonNullable<NonNullable<typeof reactor.options>["groupKeyFn"]>
    >[0];
  }

  describe("given a project ingesting several traces at once", () => {
    describe("when each trace dispatches the reactor", () => {
      it("assigns every dispatch the same lane", () => {
        const groupKeyFn = reactor.options?.groupKeyFn;
        expect(groupKeyFn).toBeDefined();

        const lanes = ["trace_1", "trace_2", "trace_3"].map((aggregateId) =>
          groupKeyFn!(payloadFor({ tenantId: "project_x", aggregateId })),
        );

        expect(new Set(lanes).size).toBe(1);
      });

      it("assigns every dispatch the same dedup id", () => {
        const makeJobId = reactor.options?.makeJobId;
        expect(makeJobId).toBeDefined();

        const jobIds = ["trace_1", "trace_2", "trace_3"].map((aggregateId) =>
          makeJobId!(payloadFor({ tenantId: "project_x", aggregateId })),
        );

        expect(new Set(jobIds).size).toBe(1);
      });
    });
  });

  describe("given two projects ingesting concurrently", () => {
    it("keeps their lanes separate so one project cannot serialize behind another", () => {
      const groupKeyFn = reactor.options!.groupKeyFn!;

      expect(
        groupKeyFn(payloadFor({ tenantId: "project_x", aggregateId: "t1" })),
      ).not.toBe(
        groupKeyFn(payloadFor({ tenantId: "project_y", aggregateId: "t1" })),
      );
    });
  });

  describe("given the lane and the dedup id are both derived from a payload", () => {
    it("varies them over exactly the same inputs", () => {
      const groupKeyFn = reactor.options!.groupKeyFn!;
      const makeJobId = reactor.options!.makeJobId!;

      const sameProjectDifferentTrace = [
        payloadFor({ tenantId: "project_x", aggregateId: "trace_1" }),
        payloadFor({ tenantId: "project_x", aggregateId: "trace_2" }),
      ] as const;
      const differentProject = payloadFor({
        tenantId: "project_y",
        aggregateId: "trace_1",
      });

      // Both collapse across traces...
      expect(groupKeyFn(sameProjectDifferentTrace[0])).toBe(
        groupKeyFn(sameProjectDifferentTrace[1]),
      );
      expect(makeJobId(sameProjectDifferentTrace[0])).toBe(
        makeJobId(sameProjectDifferentTrace[1]),
      );

      // ...and both split across projects.
      expect(groupKeyFn(sameProjectDifferentTrace[0])).not.toBe(
        groupKeyFn(differentProject),
      );
      expect(makeJobId(sameProjectDifferentTrace[0])).not.toBe(
        makeJobId(differentProject),
      );
    });
  });
});
