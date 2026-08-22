/**
 * specs/event-sourcing/multi-aggregate-pipeline.feature — declaring and
 * registering on a pipeline that owns a set of aggregate types (ADR-113).
 */
import { describe, expect, it } from "vitest";
import type { AggregateType } from "../../domain/aggregateType";
import type { Event } from "../../domain/types";
import { createMockFoldProjectionDefinition } from "../../services/__tests__/testHelpers";
import { createMockCommandHandlerClass } from "../../services/queues/__tests__/commandHandlerFixtures";
import { definePipeline } from "../staticBuilder";

const GRANT = "authz_grant" as const satisfies AggregateType;
const ROLE = "authz_role" as const satisfies AggregateType;
const GRANT_EVENTS = ["lw.authz.grant.attached", "lw.authz.grant.revoked"];
const ROLE_EVENTS = ["lw.authz.role.defined", "lw.authz.role.deleted"];

function authzPipeline() {
  return definePipeline<Event>()
    .withName("authz_grant")
    .withAggregateTypes({ [GRANT]: GRANT_EVENTS, [ROLE]: ROLE_EVENTS });
}

describe("StaticPipelineBuilder with several aggregate types", () => {
  describe("given two aggregate types each owning their events", () => {
    /** @scenario "Declaring a pipeline with two aggregate types" */
    it("lists both types in the metadata", () => {
      const definition = authzPipeline().build();

      expect(definition.metadata.aggregateScope.types).toEqual([GRANT, ROLE]);
      expect(definition.metadata.aggregateScope.eventOwners).toEqual({
        "lw.authz.grant.attached": GRANT,
        "lw.authz.grant.revoked": GRANT,
        "lw.authz.role.defined": ROLE,
        "lw.authz.role.deleted": ROLE,
      });
    });

    /** @scenario "An event type may be owned by only one aggregate on a pipeline" */
    it("refuses an event type owned twice", () => {
      expect(() =>
        definePipeline<Event>()
          .withName("authz_grant")
          .withAggregateTypes({
            [GRANT]: GRANT_EVENTS,
            [ROLE]: [...ROLE_EVENTS, "lw.authz.grant.attached"],
          }),
      ).toThrow(/"lw\.authz\.grant\.attached" is owned by both/);
    });
  });

  describe("given a single-type pipeline", () => {
    /** @scenario "A single-aggregate pipeline is unchanged" */
    it("keeps one type, binds commands to it, and carries no ownership map", () => {
      const definition = definePipeline<Event>()
        .withName("trace_processing")
        .withAggregateType("trace")
        .withCommand("recordSpan", createMockCommandHandlerClass("recordSpan"))
        .build();

      expect(definition.metadata.aggregateType).toBe("trace");
      expect(definition.metadata.aggregateScope).toEqual({ types: ["trace"] });
      expect(definition.commands[0]?.options?.aggregateType).toBeUndefined();
    });
  });

  describe("when a command is registered on the multi-aggregate pipeline", () => {
    /** @scenario "A command on a multi-aggregate pipeline must name its aggregate" */
    it("refuses a command that names no aggregate type", () => {
      expect(() =>
        authzPipeline().withCommand(
          "defineRole",
          createMockCommandHandlerClass("defineRole"),
        ),
      ).toThrow(
        /"defineRole" must name the aggregate type.*authz_grant, authz_role/,
      );
    });

    /** @scenario "A command may not bind to an aggregate its pipeline does not declare" */
    it("refuses a command bound to an undeclared aggregate type", () => {
      expect(() =>
        authzPipeline().withCommand(
          "recordSpan",
          createMockCommandHandlerClass("recordSpan"),
          { aggregateType: "trace" },
        ),
      ).toThrow(/"trace", which its pipeline does not declare/);
    });

    it("accepts a command bound to a declared aggregate type", () => {
      const definition = authzPipeline()
        .withCommand(
          "defineRole",
          createMockCommandHandlerClass("defineRole"),
          {
            aggregateType: ROLE,
          },
        )
        .build();

      expect(definition.commands[0]?.options?.aggregateType).toBe(ROLE);
    });
  });

  describe("when a fold with a custom event loader is registered", () => {
    /** @scenario "A fold with a custom event loader must declare itself type-aware on a multi-aggregate pipeline" */
    it("refuses a loader that does not declare itself aggregate-type aware", () => {
      const fold = {
        ...createMockFoldProjectionDefinition<Event>("ledger"),
        eventLoader: async () => [],
      };

      expect(() => authzPipeline().withFoldProjection("ledger", fold)).toThrow(
        /"ledger" registers a custom eventLoader.*authz_grant, authz_role/,
      );
    });

    it("accepts a loader that declares itself aggregate-type aware", () => {
      const fold = {
        ...createMockFoldProjectionDefinition<Event>("ledger"),
        eventLoader: async () => [],
        eventLoaderIsAggregateTypeAware: true,
      };

      expect(() =>
        authzPipeline().withFoldProjection("ledger", fold).build(),
      ).not.toThrow();
    });

    it("accepts any loader on a single-type pipeline", () => {
      const fold = {
        ...createMockFoldProjectionDefinition<Event>("summary"),
        eventLoader: async () => [],
      };

      expect(() =>
        definePipeline<Event>()
          .withName("trace_processing")
          .withAggregateType("trace")
          .withFoldProjection("summary", fold)
          .build(),
      ).not.toThrow();
    });
  });
});
