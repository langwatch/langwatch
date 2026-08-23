/**
 * ADR-114 — the pipeline actually DECLARES the lane and the batch bound.
 *
 * The lane module can be perfect and the change still be inert: a
 * `getGroupKey` or `coalesceMaxBatch` that never reaches the registry looks
 * exactly like one that does, and the queue quietly keeps its old shape. This
 * file asserts the registration, not the helper.
 *
 * @see specs/event-sourcing/authz-grant-command-lanes.feature
 */
import { describe, expect, it } from "vitest";
import {
  GRANT_COALESCE_MAX_BATCH,
  GRANT_SHARD_COUNT,
} from "../commands/grantCommandLane";
import { createAuthzGrantsPipeline } from "../pipeline";

function buildPipeline() {
  return createAuthzGrantsPipeline({
    authzGrantsWriteStore: {} as never,
    authzAuditTrailStore: {} as never,
  });
}

function commandNamed(name: string) {
  const entry = buildPipeline().commands.find(
    (command) => command.name === name,
  );
  if (!entry) throw new Error(`no command registered as "${name}"`);
  return entry;
}

/** The three a bulk producer emits in volume. */
const BATCHED = ["attachGrant", "changeGrantRole", "revokeGrant"] as const;

/** Rare, human-sized entities: an organization has a handful of roles. */
const UNBATCHED = [
  "defineRole",
  "changeRolePermissions",
  "deleteRole",
] as const;

describe("given the grants pipeline", () => {
  describe("when the commands a bulk producer emits are registered", () => {
    /** @scenario "The grant commands a bulk producer emits are registered to coalesce" */
    it.each(BATCHED)("%s declares a batch bound", (name) => {
      expect(commandNamed(name).options?.coalesceMaxBatch).toBe(
        GRANT_COALESCE_MAX_BATCH,
      );
    });

    /** @scenario "The grant commands a bulk producer emits are registered to coalesce" */
    it.each(BATCHED)("%s declares the sharded lane", (name) => {
      expect(typeof commandNamed(name).options?.getGroupKey).toBe("function");
    });

    /** @scenario "Commands about different grants spread across lanes" */
    it.each(
      BATCHED,
    )("%s routes different grants to different lanes", (name) => {
      const getGroupKey = commandNamed(name).options?.getGroupKey;
      if (!getGroupKey) throw new Error(`${name} declares no lane`);

      // Through the REGISTERED function, so a pipeline wired to the wrong
      // aggregate id — the mistake that would silently give every command one
      // lane — fails here rather than passing on the helper's own test.
      const lanes = new Set(
        Array.from({ length: 300 }, (_, i) =>
          getGroupKey(payloadFor({ name, grantId: `grant_${i}` })),
        ),
      );

      expect(lanes.size).toBe(GRANT_SHARD_COUNT);
    });

    /** @scenario "Commands about the same grant share a lane" */
    it.each(BATCHED)("%s keeps one grant in one lane", (name) => {
      const getGroupKey = commandNamed(name).options?.getGroupKey;
      if (!getGroupKey) throw new Error(`${name} declares no lane`);

      expect(getGroupKey(payloadFor({ name, grantId: "grant_same" }))).toBe(
        getGroupKey(payloadFor({ name, grantId: "grant_same" })),
      );
    });

    /** @scenario "The batch bound is a flat number, not a resolver" */
    it.each(BATCHED)("%s bounds the batch with a number", (name) => {
      expect(typeof commandNamed(name).options?.coalesceMaxBatch).toBe(
        "number",
      );
    });
  });

  describe("when the role commands are registered", () => {
    /** @scenario "Role commands keep the default lane" */
    it.each(UNBATCHED)("%s declares no lane override", (name) => {
      expect(commandNamed(name).options?.getGroupKey).toBeUndefined();
    });

    /** @scenario "Role commands keep the default lane" */
    it.each(UNBATCHED)("%s declares no batch bound", (name) => {
      expect(commandNamed(name).options?.coalesceMaxBatch).toBeUndefined();
    });
  });
});

/** The shape each command's `getAggregateId` reads a grant id out of. */
function payloadFor({
  name,
  grantId,
}: {
  name: string;
  grantId: string;
}): Record<string, unknown> {
  if (name === "attachGrant") {
    return { grant: { grantId } };
  }
  return { grantId };
}
