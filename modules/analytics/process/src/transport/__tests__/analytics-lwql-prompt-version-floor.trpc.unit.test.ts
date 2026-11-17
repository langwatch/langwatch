/**
 * @vitest-environment node
 * `analytics.lwql.managedPromptVersionFloor` answers what trace's read-only floor operation
 * answers, in the same shape, and only to a member holding analytics:view.
 * @see specs/lwql/stock-widgets-on-trace-metrics.feature
 */
import {
  type LangWatchQLManagedPromptVersionFloor,
  lwqlManagedPromptVersionFloorSchema,
} from "@langwatch/analytics-contract";
import { createTrpcRuntime, TrpcRootDefinition } from "@langwatch/api/trpc";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { trpcTestMembers } from "@langwatch/test-harness/trpc-members";
import { traceManagedPromptVersionFloorSchema } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { type AnalyticsLwqlApi, analyticsLwqlTrpcTransport } from "../analytics-lwql.trpc.ts";

type TestContext = { actor: { id: string } };

const PROJECT = { projectId: "project-1" };
const KNOWN_FROM = { from: "2026-07-18T00:00:00Z", rebuilding: false, unknown: false };

/** The door over an app that counts the floor reads it answers with `floor`. */
function door({
  floor,
  permits,
}: {
  floor: LangWatchQLManagedPromptVersionFloor;
  permits: (permission: string) => boolean;
}) {
  const reads = { count: 0 };
  const app = createApiFixture<AnalyticsLwqlApi>({
    managedPromptVersionFloor: async () => {
      reads.count += 1;
      return floor;
    },
  });
  const trpc = TrpcRootDefinition.forContext<TestContext>().create();
  const caller = createTrpcRuntime<TestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members: trpcTestMembers<TestContext>({ permits }),
  })
    .mount(analyticsLwqlTrpcTransport, () => app)
    .createCaller({ actor: { id: "member-1" } });
  return { caller, reads };
}

describe("given analytics.lwql.managedPromptVersionFloor", () => {
  describe("when a member holding analytics:view asks", () => {
    it("answers the floor the app read", async () => {
      const { caller, reads } = door({
        floor: KNOWN_FROM,
        permits: (permission) => permission === "analytics:view",
      });

      await expect(caller.managedPromptVersionFloor(PROJECT)).resolves.toEqual(KNOWN_FROM);
      expect(reads.count).toBe(1);
    });
  });

  describe("when a member without analytics:view asks", () => {
    it("is refused before the handler runs", async () => {
      const { caller, reads } = door({
        floor: KNOWN_FROM,
        permits: (permission) => permission !== "analytics:view",
      });

      await expect(caller.managedPromptVersionFloor(PROJECT)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(reads.count).toBe(0);
    });
  });
});

describe("given TraceApi's floor schema and the tRPC output schema", () => {
  const fixtures = [
    KNOWN_FROM,
    { from: null, rebuilding: true, unknown: false },
    { from: null, rebuilding: false, unknown: true },
    { from: null, rebuilding: false, unknown: false },
  ];
  const malformed = [
    { from: null, rebuilding: true },
    { from: 0, rebuilding: false, unknown: false },
    { from: null, rebuilding: "no", unknown: false },
  ];

  describe("when each parses the same fixtures", () => {
    it("declares the same { from, rebuilding, unknown } shape", () => {
      expect(z.toJSONSchema(lwqlManagedPromptVersionFloorSchema)).toEqual(
        z.toJSONSchema(traceManagedPromptVersionFloorSchema),
      );
    });

    it.each(fixtures)("reads %o the same both ways", (fixture) => {
      const viaTrace = traceManagedPromptVersionFloorSchema.parse(fixture);

      expect(lwqlManagedPromptVersionFloorSchema.parse(viaTrace)).toEqual(fixture);
      expect(
        traceManagedPromptVersionFloorSchema.parse(
          lwqlManagedPromptVersionFloorSchema.parse(fixture),
        ),
      ).toEqual(fixture);
    });

    it.each(malformed)("refuses %o both ways", (fixture) => {
      expect(traceManagedPromptVersionFloorSchema.validate(fixture)).toBe(false);
      expect(lwqlManagedPromptVersionFloorSchema.validate(fixture)).toBe(false);
    });
  });
});
