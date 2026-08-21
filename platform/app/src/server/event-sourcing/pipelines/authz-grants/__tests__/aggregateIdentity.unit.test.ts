/** @vitest-environment node */

/**
 * ADR-110's central invariant: a command stamps the entity it is about as the
 * aggregate, never the organization.
 *
 * This is the defect the ADR exists for. With `aggregateId = organizationId`
 * one aggregate's state was every grant the organization had ever held, so the
 * projection re-read all of them on every batch and an import decelerated as
 * it grew until no timeout could contain it. A test that only checked the
 * emitted event's shape would have passed throughout.
 */
import { describe, expect, it } from "vitest";
import {
  AttachGrantCommand,
  ChangeGrantRoleCommand,
  ChangeRolePermissionsCommand,
  DefineRoleCommand,
  DeleteRoleCommand,
  RevokeGrantCommand,
} from "../commands/grantsLedgerCommands";
import {
  AUTHZ_GRANT_AGGREGATE_TYPE,
  AUTHZ_ROLE_AGGREGATE_TYPE,
} from "../schemas/constants";

const ORG = "org_acme";
const ACTOR = { type: "user", id: "user_admin" } as const;
const AT = 1_755_000_000_000;

const identity = { tenantId: ORG, organizationId: ORG, commandId: "cmd_1" };

const GRANT = {
  grantId: "grant_1",
  principal: { type: "user", id: "user_alice" },
  roleKey: "member",
  scope: { type: "TEAM", id: "team_1" },
  source: "grants-service",
  actor: ACTOR,
  occurredAtMs: AT,
} as const;

const ROLE = {
  roleId: "role_1",
  name: "Auditor",
  permissions: ["traces:view"],
  kind: "custom",
  occurredAtMs: AT,
} as const;

async function emit(
  handler: { handle: (c: never) => Promise<unknown[]> },
  data: unknown,
) {
  return (await handler.handle({ tenantId: ORG, data } as never)) as {
    aggregateType: string;
    aggregateId: string;
    idempotencyKey: string;
    occurredAt: number;
  }[];
}

describe("authz command aggregate identity", () => {
  describe("given a command about one grant", () => {
    /** @scenario "A grant command names its own grant as the aggregate" */
    it.each([
      ["attach", new AttachGrantCommand(), { ...identity, grant: GRANT }],
      [
        "change role",
        new ChangeGrantRoleCommand(),
        {
          ...identity,
          grantId: "grant_1",
          from: "member",
          to: "admin",
          actor: ACTOR,
          occurredAtMs: AT,
        },
      ],
      [
        "revoke",
        new RevokeGrantCommand(),
        {
          ...identity,
          grantId: "grant_1",
          actor: ACTOR,
          occurredAtMs: AT,
        },
      ],
    ])("stamps the grant id on %s, not the organization", async (_, handler, data) => {
      const [event] = await emit(handler as never, data);

      expect(event?.aggregateId).toBe("grant_1");
      expect(event?.aggregateId).not.toBe(ORG);
      expect(event?.aggregateType).toBe(AUTHZ_GRANT_AGGREGATE_TYPE);
    });
  });

  describe("given a command about one role", () => {
    /** @scenario "A role command names its own role as the aggregate" */
    it.each([
      [
        "define",
        new DefineRoleCommand(),
        { ...identity, role: ROLE, actor: ACTOR },
      ],
      [
        "change permissions",
        new ChangeRolePermissionsCommand(),
        {
          ...identity,
          roleId: "role_1",
          permissions: ["traces:view"],
          actor: ACTOR,
          occurredAtMs: AT,
        },
      ],
      [
        "delete",
        new DeleteRoleCommand(),
        { ...identity, roleId: "role_1", actor: ACTOR, occurredAtMs: AT },
      ],
    ])("stamps the role id on %s, not the organization", async (_, handler, data) => {
      const [event] = await emit(handler as never, data);

      expect(event?.aggregateId).toBe("role_1");
      expect(event?.aggregateId).not.toBe(ORG);
      expect(event?.aggregateType).toBe(AUTHZ_ROLE_AGGREGATE_TYPE);
    });
  });

  describe("when the same command is retried", () => {
    /**
     * The retry has to dedupe at the event store, and the key is what does
     * it. A command that emits one event always uses index 0, so two sends
     * of one commandId are the same key.
     *
     * @scenario "A retried command dedupes at the event store"
     */
    it("emits the same idempotency key both times", async () => {
      const data = { ...identity, grant: GRANT };
      const [first] = await emit(new AttachGrantCommand() as never, data);
      const [second] = await emit(new AttachGrantCommand() as never, data);

      expect(first?.idempotencyKey).toBe(second?.idempotencyKey);
      expect(first?.idempotencyKey).toBe("cmd_1:0");
    });

    /** @scenario "Two grants under one action never collide" */
    it("gives two grants distinct keys even under one action", async () => {
      const [first] = await emit(new AttachGrantCommand() as never, {
        ...identity,
        commandId: "cmd_1:grant_1",
        grant: GRANT,
      });
      const [second] = await emit(new AttachGrantCommand() as never, {
        ...identity,
        commandId: "cmd_1:grant_2",
        grant: { ...GRANT, grantId: "grant_2" },
      });

      expect(first?.idempotencyKey).not.toBe(second?.idempotencyKey);
    });
  });

  describe("when a fact carries its own business time", () => {
    /** @scenario "An imported grant keeps the time it was originally made" */
    it("stamps occurredAt from the fact, not the clock", async () => {
      const backdated = AT - 86_400_000;
      const [event] = await emit(new AttachGrantCommand() as never, {
        ...identity,
        grant: { ...GRANT, occurredAtMs: backdated },
      });

      expect(event?.occurredAt).toBe(backdated);
    });
  });
});
