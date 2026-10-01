import { defineTrpcContract, type TrpcContract } from "@langwatch/module";
/**
 * The projection reads the kernel collects from installed contracts, and the boot refusals.
 * Spec: packages/eventing/specs/projection-cursor-reads.feature.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  installProjectionReads,
  projectionReadsOf,
  type EventingHost,
} from "../src/module-eventing.ts";

const runs = defineTrpcContract("runs")
  .query("get", { fromProjection: [{ projection: "runState", key: "runId" }] })
  .withInput(z.object({ projectId: z.string(), runId: z.string() }))
  .withOutput(z.unknown())
  .query("list", { fromProjection: ["runState"] })
  .withInput(z.object({ projectId: z.string() }))
  .withOutput(z.unknown())
  .build();

function eventingNaming(projections: readonly string[] | undefined): EventingHost {
  return {
    participation: "consume",
    processStore: undefined,
    register: () => ({}),
    ...(projections === undefined ? {} : { projectionNames: () => new Set(projections) }),
  };
}

function declaredWith(contract: TrpcContract) {
  return [
    {
      feature: "runs",
      transports: [{ protocol: "trpc" as const, namespace: "runs", router: () => ({}), contract }],
      provided: () => ({}),
      facts: [],
    },
  ];
}

describe("projectionReadsOf", () => {
  it("maps each projection to every read served from it, with its key field", () => {
    expect(projectionReadsOf({ contracts: [runs] }).get("runState")).toEqual([
      { path: "runs.get", key: "runId" },
      { path: "runs.list" },
    ]);
  });

  /** @scenario "A cursor-backed read cannot also declare event-bound hints" */
  it("refuses a read that declares both fromProjection and invalidatedBy", () => {
    const both = defineTrpcContract("runs")
      .query("get", { fromProjection: ["runState"], invalidatedBy: ["lw.run.finished"] })
      .withInput(z.object({}))
      .withOutput(z.unknown())
      .build();

    expect(() => projectionReadsOf({ contracts: [both] })).toThrow(
      expect.objectContaining({ code: "read_cursor_and_hints", paths: ["runs.get"] }),
    );
  });
});

describe("installProjectionReads", () => {
  /** @scenario "A read naming a projection no installed pipeline registers is refused at boot" */
  it("refuses a read naming a projection no installed pipeline declares, naming both", () => {
    const install = () =>
      installProjectionReads({
        eventing: eventingNaming(["runStatus"]),
        declared: declaredWith(runs),
      });

    expect(install).toThrow(
      expect.objectContaining({
        code: "read_unknown_projection",
        paths: ["runs.get", "runs.list"],
        message: expect.stringContaining("runState (runs.get, runs.list)"),
      }),
    );
  });

  it("accepts reads whose projections are all declared", () => {
    expect(() =>
      installProjectionReads({
        eventing: eventingNaming(["runState"]),
        declared: declaredWith(runs),
      }),
    ).not.toThrow();
  });

  it("skips the projection check on a runtime that cannot list its projections", () => {
    expect(() =>
      installProjectionReads({ eventing: eventingNaming(void 0), declared: declaredWith(runs) }),
    ).not.toThrow();
    expect(() =>
      installProjectionReads({ eventing: void 0, declared: declaredWith(runs) }),
    ).not.toThrow();
  });
});
