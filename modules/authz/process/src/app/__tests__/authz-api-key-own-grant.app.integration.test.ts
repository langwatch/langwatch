/**
 * @vitest-environment node
 * An API key's own role and grant, sent as the held-key mint sends them each try, over the authz
 * app's grants pipeline in memory. The key service is not composed: api-key-process cannot depend
 * on authz-process, so each try sends what `ApiKeyGrantPolicyService.writeBindings` sends: the
 * key's stable command id and binding id on its create, none of its own on an edit.
 * @see specs/rbac/authz-grants.feature
 */
import type { LedgerActor } from "@langwatch/authorization";
import {
  API_KEY_OWN_GRANT_COMMAND_PREFIX,
  GRANT_ATTACHED_EVENT_TYPE,
  newAuthzGrantId,
  ROLE_DEFINED_EVENT_TYPE,
} from "@langwatch/authz-contract";
import { createTenantId, EventSourcing } from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { afterEach, describe, expect, it } from "vitest";

import {
  AUTHZ_GRANT_AGGREGATE_TYPE,
  type AuthzGrantsEvent,
} from "../../eventing/authz-grant.events.ts";
import { EventingAuthzLedgerAdapter } from "../../eventing/authz-grant.store.ts";
import { AuthzMemoryStore } from "../../repositories/memory/authz-memory.store.ts";
import { MemoryAuthzLedgerReadRepository } from "../../repositories/memory/memory.authz-ledger-read.repository.ts";
import { AuthzCommandDispatcherService } from "../../services/authz-grants-command-dispatcher.service.ts";
import { AuthzModule, type AuthzSetup } from "../authz.app.ts";
import { repositoriesOver } from "./authz-braid-world.fixture.ts";
import { memoryAuthzChannels } from "./authz-channels.fixture.ts";

// Mirrors the held key in modules/api-key/process/src/services/__tests__/
// held-key-mint.slow-fold.unit.test.ts, whose key id, content hash and creation time are minted
// there, so only their shapes are mirrored: a rolebinding id, and the command id
// `ownGrantCommandId` (modules/api-key/process/src/services/api-key-own-grant-ids.ts) builds.
const ORG = "org_1";
const KEY = "key_held";
const ROLE = `apikey:${KEY}`;
const ACTOR: LedgerActor = { type: "system", id: null };
/** `ownGrantCommandId`'s shape: the contract prefix, the key id, then a 32-hex content hash. */
const OWN_GRANT_COMMAND_ID = new RegExp(`^${API_KEY_OWN_GRANT_COMMAND_PREFIX}${KEY}:[0-9a-f]{32}$`);
const CREATE = {
  commandId: `${API_KEY_OWN_GRANT_COMMAND_PREFIX}${KEY}:6f1c2a9d0b7e4c3a8d5f9e2b1a0c7d64`,
  bindingId: newAuthzGrantId(),
  // The key's creation, a minute before the test's writes, as each retry of its create sends it.
  occurredAtMs: Date.now() - 60_000,
};
/** A built-in role the same create grants beside the key's own, under the same command id. */
const EXTRA_BINDING_ID = newAuthzGrantId();
const REFUSED = { code: "authz_grant_not_confirmed" };

/**
 * The Grant and Role heads as a reader behind the fold sees them: a table shows what the fold
 * wrote only once the test lands it, so a try's hold runs out as it would on a slow fold.
 */
function laggingReads(memory: AuthzMemoryStore) {
  const seen = AuthzMemoryStore.create();
  return {
    reads: MemoryAuthzLedgerReadRepository.create({ memory: seen }),
    landRoles: () => {
      const rows = memory.roleHeads.map((row) => ({ ...row }));
      seen.roleHeads.splice(0, seen.roleHeads.length, ...rows);
    },
    landGrants: () => {
      const rows = memory.grants.map((row) => ({ ...row }));
      seen.grants.splice(0, seen.grants.length, ...rows);
    },
  };
}

let closers: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closers.map((close) => close()));
  closers = [];
});

/** The composed app's pipeline, and a ledger adapter over it with a short read-your-writes hold. */
function world({ lagging = false }: { lagging?: boolean } = {}) {
  const memory = AuthzMemoryStore.create();
  const repositories = repositoriesOver(memory);
  const app = AuthzModule.create({
    dependencies: {},
    config: {
      epochCacheEnabled: false,
      demoProjectId: undefined,
      demoProjectUserId: undefined,
      demoProjectSlug: undefined,
    },
    resources: { own: () => void 0, ownService: () => void 0 },
    secrets: createApiFixture<AuthzSetup["secrets"]>(),
    repositories,
    channels: memoryAuthzChannels(),
  });
  const eventStore = EventStoreMemory.createForTesting<AuthzGrantsEvent>();
  const eventing = new EventSourcing({ eventStore });
  closers.push(() => eventing.close());
  const registered = eventing.register(app.eventingPipeline()).commands;
  app.connectCommands(registered);

  // Every append the ledger makes, by command, before the log merges any.
  const appended: string[] = [];
  const counted = Object.fromEntries(
    Object.entries(registered).map(([name, sender]) => [
      name,
      {
        send: (data: unknown) => {
          appended.push(name);
          return (sender as { send: (data: unknown) => Promise<unknown> }).send(data);
        },
      },
    ]),
  );
  const dispatcher = AuthzCommandDispatcherService.create();
  dispatcher.connect(AuthzCommandDispatcherService.sendersFrom(counted));
  const projection = lagging ? laggingReads(memory) : undefined;
  const ledger = EventingAuthzLedgerAdapter.create({
    reads: projection?.reads ?? repositories.ledgerReads,
    lineage: repositories.read,
    dispatcher,
    epoch: repositories.epoch,
    revocation: repositories.revocation,
    membershipStamps: repositories.membershipStamps,
    poll: { intervalMs: 1, timeoutMs: 25 },
  });

  /**
   * One try of the held-key mint's grant write, as the api-key slow-fold test pins it on every try
   * ("sends the key's stable ids on every try"); an edit sends a fresh binding id and no command
   * id. `caller` stops at the grants service. An extra binding is attached first, as there.
   */
  async function grantKey(
    ids: {
      commandId?: string;
      occurredAtMs?: number;
      bindingId: string;
      extraBindingId?: string;
    } = CREATE,
  ): Promise<{ attached: string[]; duplicates: string[] }> {
    const commandId = ids.commandId
      ? { commandId: ids.commandId, occurredAtMs: ids.occurredAtMs }
      : {};
    await ledger.defineRole({
      organizationId: ORG,
      roleId: ROLE,
      name: ROLE,
      permissions: ["traces:view"],
      kind: "system_api_key",
      actor: ACTOR,
      ...commandId,
      requireProjection: true,
    });
    const extra = ids.extraBindingId
      ? await ledger.attachBindings({
          organizationId: ORG,
          bindings: [
            {
              bindingId: ids.extraBindingId,
              principal: { apiKeyId: KEY },
              role: "VIEWER",
              customRoleId: null,
              scopeType: "ORGANIZATION",
              scopeId: ORG,
            },
          ],
          actor: ACTOR,
          source: "grants-service",
          onDuplicate: "skip",
          ...commandId,
          requireProjection: true,
        })
      : { attached: [], duplicates: [] };
    const own = await ledger.attachBindings({
      organizationId: ORG,
      bindings: [
        {
          bindingId: ids.bindingId,
          principal: { apiKeyId: KEY },
          role: "CUSTOM",
          customRoleId: ROLE,
          scopeType: "ORGANIZATION",
          scopeId: ORG,
        },
      ],
      actor: ACTOR,
      source: "grants-service",
      onDuplicate: "skip",
      ...commandId,
      requireProjection: true,
    });
    return {
      attached: [...extra.attached, ...own.attached],
      duplicates: [...extra.duplicates, ...own.duplicates],
    };
  }

  const eventsOf = async (aggregateId: string, type: string) =>
    (
      await eventStore.getEvents({
        aggregateId,
        context: { tenantId: createTenantId(ORG) },
        aggregateType: AUTHZ_GRANT_AGGREGATE_TYPE,
      })
    ).filter((event) => event.type === type);
  const auditRows = (action: string, field: string, value: string) =>
    memory.auditLogs.filter(
      (row) => row.action === `authz.grants.${action}` && row.metadata[field] === value,
    );
  const keyGrants = () => memory.grants.filter((row) => row.principalId === KEY);

  return { memory, ledger, projection, appended, grantKey, eventsOf, auditRows, keyGrants };
}

describe("given an API key's own role and grant written on each try of a held-key mint", () => {
  describe("when the fold lands the role and the grant only after two tries each", () => {
    /** @scenario "A held key whose role and grant land after a slow fold has one of each" */
    it("stores one role_defined and one grant.attached, each with one audit row", async () => {
      const { projection, appended, grantKey, eventsOf, auditRows, keyGrants } = world({
        lagging: true,
      });
      if (!projection) throw new Error("the world has no lagging reader");
      expect(CREATE.commandId).toMatch(OWN_GRANT_COMMAND_ID);

      // Tries 1 and 2: the role is appended, but the reader never sees it within the hold.
      await expect(grantKey()).rejects.toMatchObject(REFUSED);
      await expect(grantKey()).rejects.toMatchObject(REFUSED);
      projection.landRoles();
      // Tries 3 and 4: the role is read back; the grant is not seen yet.
      await expect(grantKey()).rejects.toMatchObject(REFUSED);
      await expect(grantKey()).rejects.toMatchObject(REFUSED);
      projection.landGrants();
      const settled = await grantKey();

      const [grant] = keyGrants();
      if (!grant) throw new Error("no grant was folded for the key");
      expect(settled).toEqual({ attached: [], duplicates: [CREATE.bindingId] });
      // The role is appended on every try and the grant on each try before it is read back, all
      // under the key's ids, so the log keeps one of each.
      expect(appended.filter((name) => name === "defineRole")).toHaveLength(5);
      expect(appended.filter((name) => name === "attachGrant")).toHaveLength(2);
      expect(await eventsOf(ROLE, ROLE_DEFINED_EVENT_TYPE)).toHaveLength(1);
      expect(await eventsOf(grant.id, GRANT_ATTACHED_EVENT_TYPE)).toHaveLength(1);
      expect(keyGrants()).toEqual([expect.objectContaining({ id: grant.id, revokedAt: null })]);
      expect(auditRows("role_defined", "roleId", ROLE)).toHaveLength(1);
      expect(auditRows("attach", "grantId", grant.id)).toHaveLength(1);
      expect(auditRows("attach", "roleKey", `custom:${ROLE}`)).toHaveLength(1);
    });
  });

  describe("when the key also holds a built-in role, retried before its grant lands", () => {
    /** @scenario "A held key's other grant retried before the fold has one audit row" */
    it("stores one grant.attached and one audit row for each of the key's grants", async () => {
      const { projection, appended, grantKey, eventsOf, auditRows, keyGrants } = world({
        lagging: true,
      });
      if (!projection) throw new Error("the world has no lagging reader");
      const ids = { ...CREATE, extraBindingId: EXTRA_BINDING_ID };
      const grantIds = [EXTRA_BINDING_ID, CREATE.bindingId];

      // Try 1: the role is not read back yet.
      await expect(grantKey(ids)).rejects.toMatchObject(REFUSED);
      projection.landRoles();
      // Tries 2 and 3: the extra grant is appended and not read back; try 3 retries it.
      await expect(grantKey(ids)).rejects.toMatchObject(REFUSED);
      await expect(grantKey(ids)).rejects.toMatchObject(REFUSED);
      projection.landGrants();
      // Try 4: the extra grant is read back; the key's own grant is appended, not read back.
      await expect(grantKey(ids)).rejects.toMatchObject(REFUSED);
      projection.landGrants();
      const settled = await grantKey(ids);

      expect(settled).toEqual({ attached: [], duplicates: grantIds });
      expect(appended.filter((name) => name === "attachGrant")).toHaveLength(3);
      for (const grantId of grantIds) {
        expect(await eventsOf(grantId, GRANT_ATTACHED_EVENT_TYPE)).toHaveLength(1);
        expect(auditRows("attach", "grantId", grantId)).toHaveLength(1);
      }
      const live = keyGrants().filter((row) => row.revokedAt === null);
      expect(live.map((row) => row.id).toSorted()).toEqual(grantIds.toSorted());
    });
  });

  describe("when the key's role is edited and a late retry of its create follows", () => {
    /** @scenario "A late copy of a key's create never overwrites a later edit" */
    it("keeps the edit, as the retry carries the key's creation time", async () => {
      const { ledger, grantKey, memory, eventsOf } = world();
      const edited = ["traces:view", "traces:share"];

      await grantKey();
      await ledger.defineRole({
        organizationId: ORG,
        roleId: ROLE,
        name: ROLE,
        permissions: edited,
        kind: "system_api_key",
        actor: ACTOR,
      });
      // The retry waits for its own content, which the edit has replaced for good. api-key
      // refuses any edit before the create activates the key, so no real retry meets this.
      await expect(grantKey()).rejects.toMatchObject(REFUSED);

      const role = memory.roleHeads.find((row) => row.id === ROLE);
      expect(role?.permissions).toEqual(edited);
      expect(role?.deletedAt).toBeNull();
      // The wiring: the create's stamp reaches the event the fold guards on, below the edit's.
      const stampOf = async (permissions: string[]) =>
        (await eventsOf(ROLE, ROLE_DEFINED_EVENT_TYPE)).find(
          (event) =>
            JSON.stringify((event.data as { permissions: string[] }).permissions) ===
            JSON.stringify(permissions),
        )?.occurredAt;
      expect(await stampOf(["traces:view"])).toBe(CREATE.occurredAtMs);
      expect(await stampOf(edited)).toBeGreaterThan(CREATE.occurredAtMs);
    });
  });

  describe("when the key's grant is revoked and an edit grants it again", () => {
    /** @scenario "A revoked API key grant attached again is recorded as a new grant" */
    it("attaches a new live grant under a new id and records it", async () => {
      const { ledger, grantKey, eventsOf, auditRows, keyGrants } = world();

      const first = await grantKey();
      const [firstId] = first.attached;
      if (!firstId) throw new Error("the first grant was not attached");
      await ledger.revokeBindings({ organizationId: ORG, bindingIds: [firstId], actor: ACTOR });
      const second = await grantKey({ bindingId: newAuthzGrantId() });
      const [secondId] = second.attached;
      if (!secondId) throw new Error("the second grant was not attached");

      expect(secondId).not.toBe(firstId);
      expect(keyGrants().filter((row) => row.revokedAt === null).map((row) => row.id)).toEqual([
        secondId,
      ]);
      expect(await eventsOf(secondId, GRANT_ATTACHED_EVENT_TYPE)).toHaveLength(1);
      expect(auditRows("attach", "grantId", firstId)).toHaveLength(1);
      expect(auditRows("attach", "grantId", secondId)).toHaveLength(1);
    });
  });

  describe("when an API key is bound to a custom role and a built-in role", () => {
    /** @scenario "Grants other than an API key's own keep the ids they are attached under" */
    it("keeps each asked-for id and audits each grant under its event id", async () => {
      const { ledger, eventsOf, memory } = world();
      await ledger.defineRole({
        organizationId: ORG,
        roleId: "role_reviewer",
        name: "Reviewer",
        permissions: ["traces:view"],
        kind: "custom",
        actor: ACTOR,
      });
      const binding = {
        principal: { apiKeyId: KEY },
        scopeType: "ORGANIZATION" as const,
        scopeId: ORG,
      };

      const outcome = await ledger.attachBindings({
        organizationId: ORG,
        bindings: [
          { ...binding, bindingId: "rb_custom", role: "CUSTOM", customRoleId: "role_reviewer" },
          { ...binding, bindingId: "rb_builtin", role: "VIEWER", customRoleId: null },
        ],
        actor: ACTOR,
        onDuplicate: "skip",
      });

      expect(outcome).toEqual({ attached: ["rb_custom", "rb_builtin"], duplicates: [] });
      for (const grantId of outcome.attached) {
        const [event] = await eventsOf(grantId, GRANT_ATTACHED_EVENT_TYPE);
        expect(memory.auditLogs.map((row) => row.id)).toContain(`authz-evt-${event?.id}`);
      }
    });
  });
});
