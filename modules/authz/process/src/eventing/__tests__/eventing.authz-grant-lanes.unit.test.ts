/**
 * Pipeline declares the ordered lane; assert registration to detect silent
 * inertness (ADR-114 amended).
 */
import { describe, expect, it } from "vitest";

import {
  AttachGrantCommand,
  ChangeGrantRoleCommand,
  GRANT_COALESCE_MAX_BATCH,
  RevokeGrantCommand,
} from "../authz-grant.commands.ts";
import { EventingAuthzAdapter } from "../authz-grant.pipeline.ts";

function buildPipeline() {
  return EventingAuthzAdapter.build({
    authzGrantsWriteStore: {} as never,
    authzAuditTrailStore: {} as never,
  });
}

function commandNamed(name: string) {
  const entry = buildPipeline().commands.find((command) => command.definition.name === name);
  if (!entry) throw new Error(`no command registered as "${name}"`);
  return entry;
}

/** The three that change one grant, and must apply to it in order. */
const GRANT_COMMANDS = ["attachGrant", "changeGrantRole", "revokeGrant"] as const;

/** Rare, human-sized entities: an organization has a handful of roles. */
const ROLE_COMMANDS = ["defineRole", "changeRolePermissions", "deleteRole"] as const;

describe("given the grants pipeline", () => {
  describe("when the commands that change a grant are registered", () => {
    /** @scenario "Every command about one grant rides one lane" */
    it.each(GRANT_COMMANDS)("%s serializes on the grant", (name) => {
      expect(commandNamed(name).definition.options?.serializeByAggregate).toBe(true);
    });

    /** @scenario "Every command about one grant rides one lane" */
    it.each(GRANT_COMMANDS)("%s declares no lane override", (name) => {
      // `queueManager` IGNORES `getGroupKey` once `serializeByAggregate` is
      // set. One left here would read as an active lane choice while doing
      // nothing at all — the failure this assertion exists to prevent.
      expect(commandNamed(name).definition.options?.getGroupKey).toBeUndefined();
    });

    /** @scenario "A grant's attach and its revoke share one lane" */
    it("resolves an attach and a revoke of one grant to the same aggregate", () => {
      // The lane IS the aggregate id once `serializeByAggregate` is set, and
      // the job path drops the command name — so these two agreeing is what
      // puts an attach and the revoke that follows it in one FIFO lane.
      expect(AttachGrantCommand.getAggregateId({ grant: { grantId: "grant_same" } } as never)).toBe(
        RevokeGrantCommand.getAggregateId({ grantId: "grant_same" } as never),
      );
      expect(ChangeGrantRoleCommand.getAggregateId({ grantId: "grant_same" } as never)).toBe(
        "grant_same",
      );
    });

    /** @scenario "Commands about different grants stay independent" */
    it("resolves different grants to different aggregates", () => {
      // The lane is now the aggregate id alone, so an id that collapsed to
      // the ORGANIZATION would serialize every grant it owns into a single
      // lane. That is the regression this catches, and it would show up as
      // throughput, not as a wrong answer.
      expect(
        AttachGrantCommand.getAggregateId({ grant: { grantId: "grant_a" } } as never),
      ).not.toBe(AttachGrantCommand.getAggregateId({ grant: { grantId: "grant_b" } } as never));
    });

    /** @scenario "A grant's queued commands fold into one insert" */
    it.each(GRANT_COMMANDS)("%s bounds the batch with a number", (name) => {
      expect(commandNamed(name).definition.options?.coalesceMaxBatch).toBe(
        GRANT_COALESCE_MAX_BATCH,
      );
      expect(typeof GRANT_COALESCE_MAX_BATCH).toBe("number");
    });
  });

  describe("when the role commands are registered", () => {
    /** @scenario "Role commands keep the default lane" */
    it.each(ROLE_COMMANDS)("%s declares no serialization", (name) => {
      expect(commandNamed(name).definition.options?.serializeByAggregate).toBeUndefined();
    });

    /** @scenario "Role commands keep the default lane" */
    it.each(ROLE_COMMANDS)("%s declares no batch bound", (name) => {
      expect(commandNamed(name).definition.options?.coalesceMaxBatch).toBeUndefined();
    });
  });
});
