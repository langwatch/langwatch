/**
 * @vitest-environment node
 * Each create path through the real key service and governance events over memory repositories:
 * what the created fact says of who made the key and who it is for.
 * @see modules/gateway/specs/gateway-governance-events.feature
 */
import { SYSTEM_ACTORS } from "@langwatch/authorization";
import {
  type RecordVkLifecycleCommandData,
  recordVkLifecycleCommandDataSchema,
} from "@langwatch/gateway-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { VirtualKeyCryptoService } from "../../features/virtual-key/services/virtual-key-crypto.service.ts";
import { VirtualKeyService } from "../../features/virtual-key/services/virtual-key.service.ts";
import { MemoryGatewayRepositories } from "../../repositories/memory/memory.gateway.repositories.ts";
import {
  ConnectManagedKeyService,
  type ConnectManagedKeyWrites,
} from "../connect-managed-key.service.ts";
import { GatewayGovernanceEventsService } from "../gateway-governance-events.service.ts";
import {
  type GatewayPlatformProviders,
  GatewayScopeResolutionService,
} from "../gateway-scope-resolution.service.ts";

const NOW = Temporal.Instant.from("2026-11-17T10:00:00Z");
const ORGANIZATION_ID = "org_1";
const PROJECT_SCOPE = [{ scopeType: "PROJECT" as const, scopeId: "project_1" }];

/** The key service as the app composes it, its lifecycle facts parsed and kept as recorded. */
function keysRecordingLifecycle() {
  const recorded: RecordVkLifecycleCommandData[] = [];
  const projects = createApiFixture<ProjectApi>({
    listIdsByOrganization: async () => ["project_1"],
    resolveTraceDestination: async () => ({
      outcome: "resolved",
      project: { id: "project_1", teamId: "team_1", archivedAt: null, kind: "application" },
    }),
  });
  const governance = GatewayGovernanceEventsService.create({ projects, clock: () => NOW });
  governance.connect({
    recordVkLifecycle: {
      send: async (payload) => {
        recorded.push(recordVkLifecycleCommandDataSchema.parse(payload));
      },
    },
  });
  const repositories = MemoryGatewayRepositories.create();
  const virtualKeys = VirtualKeyService.create({
    transactions: repositories.transactions,
    keyBudgets: repositories.keyBudgets,
    scopeResolution: GatewayScopeResolutionService.create({
      repository: repositories.scopeResolution,
      platformProviders: createApiFixture<GatewayPlatformProviders>({}),
      projects,
    }),
    projects,
    repository: repositories.virtualKeys,
    changeEvents: repositories.changeEvents,
    auditLog: repositories.audit,
    crypto: VirtualKeyCryptoService.create({ pepper: "test-virtual-key-pepper" }),
    governanceSignals: governance,
  });
  return { virtualKeys, recorded };
}

/** The one created fact, after checking no machine principal was written in it. */
function createdFactOf(recorded: readonly RecordVkLifecycleCommandData[]) {
  expect(JSON.stringify(recorded)).not.toMatch(/svc_|system:/);
  expect(recorded.map(({ action }) => action)).toEqual(["created"]);
  return recorded[0];
}

describe("the created key's lifecycle fact", () => {
  describe("when a signed-in person creates a key for someone", () => {
    /** @scenario "A created key's fact names the person who made it and the person it acts for" */
    it("names the person as actor, the key's principal and purpose USER", async () => {
      const { virtualKeys, recorded } = keysRecordingLifecycle();

      await virtualKeys.create({
        organizationId: ORGANIZATION_ID,
        name: "Jane's key",
        principalUserId: "user_bob",
        scopes: PROJECT_SCOPE,
        actorUserId: "user_jane",
      });

      expect(createdFactOf(recorded)).toMatchObject({
        actor_user_id: "user_jane",
        principal_user_id: "user_bob",
        purpose: "USER",
      });
    });
  });

  describe("when an API key with no owner creates a key", () => {
    /** @scenario "A created key's fact names the person who made it and the person it acts for" */
    it("names no actor for the svc_ principal the REST door resolves, and keeps the principal", async () => {
      const { virtualKeys, recorded } = keysRecordingLifecycle();

      await virtualKeys.create({
        organizationId: ORGANIZATION_ID,
        name: "CI key",
        principalUserId: "user_bob",
        scopes: PROJECT_SCOPE,
        actorUserId: "svc_apikey_1",
      });

      expect(createdFactOf(recorded)).toMatchObject({
        actor_user_id: null,
        principal_user_id: "user_bob",
        purpose: "USER",
      });
    });
  });

  describe("when a legacy project key creates a key", () => {
    /** @scenario "A created key's fact names the person who made it and the person it acts for" */
    it("names no actor for its svc_<project> principal and no principal it was not given", async () => {
      const { virtualKeys, recorded } = keysRecordingLifecycle();

      await virtualKeys.create({
        organizationId: ORGANIZATION_ID,
        name: "Legacy key",
        principalUserId: null,
        scopes: PROJECT_SCOPE,
        actorUserId: "svc_project_1",
      });

      expect(createdFactOf(recorded)).toMatchObject({
        actor_user_id: null,
        principal_user_id: null,
        purpose: "USER",
      });
    });
  });

  describe("when a Connect licence provisions its managed key", () => {
    /** @scenario "A created key's fact names the person who made it and the person it acts for" */
    it("names no actor and no principal, with purpose CONNECT", async () => {
      const { virtualKeys, recorded } = keysRecordingLifecycle();
      const connect = ConnectManagedKeyService.create({
        virtualKeys: createApiFixture<ConnectManagedKeyWrites>({
          create: (input) => virtualKeys.create(input),
        }),
        home: { ensureInternal: async () => ({ id: "project_1" }) },
      });

      await connect.provision({
        organizationId: ORGANIZATION_ID,
        licenseId: "licence_1",
        actorUserId: SYSTEM_ACTORS.connectLicense,
      });

      expect(createdFactOf(recorded)).toMatchObject({
        actor_user_id: null,
        principal_user_id: null,
        purpose: "CONNECT",
      });
    });
  });
});
