// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * A directory push and the history it writes: a person is provisioned whether
 * or not the process can record that it happened. `ScimService` runs over the
 * in-memory SCIM store, its lifecycle over the real ledger writer.
 * @see specs/server/api-process-eventing.feature
 */
import {
  SCIM_USER_PUSHED_EVENT_TYPE,
  type ScimSyncFactInput,
} from "@langwatch/enterprise-scim-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import { createTestLogger } from "@langwatch/test-harness";
import { describe, expect, it, vi } from "vitest";

import { GrantsFake } from "../../__tests__/support/grants-fake.ts";
import { OrganizationAdministrationFake } from "../../__tests__/support/organization-administration-fake.ts";
import { MemoryScimRepository } from "../../repositories/memory/memory.scim.repository.ts";
import { ScimSyncLedgerWriterService } from "../eventing-scim-sync-ledger.service.ts";
import type { ScimUserProvisioning } from "../scim-provisioning.service.ts";
import {
  ScimSyncLifecycleService,
  type ScimSyncLifecycleGuards,
} from "../scim-sync-lifecycle.service.ts";
import { ScimService } from "../scim.service.ts";

const ORGANIZATION = "org_acme";
const CONNECTION = "conn_okta_primary";

class EnterpriseEntitlements implements Pick<EntitlementApi, "getActivePlan"> {
  async getActivePlan() {
    return {
      planSource: "free" as const,
      type: "ENTERPRISE",
      name: "Enterprise",
      free: false,
      maxMembers: 10,
      maxMembersLite: 10,
      maxMessagesPerMonth: 1,
      canPublish: true,
      prices: { USD: 0, EUR: 0 },
    };
  }
}

/** Guards that state a user-pushed fact; the other verbs state nothing. */
function guards(): ScimSyncLifecycleGuards {
  return {
    issueScimToken: async () => [],
    recordScimUserPush: async (data): Promise<ScimSyncFactInput[]> => [
      {
        type: SCIM_USER_PUSHED_EVENT_TYPE,
        data: {
          scimSyncId: data.scimSyncId,
          connectionId: data.connectionId,
          organizationId: data.organizationId,
          userId: data.userId,
          externalId: data.externalId,
          op: data.op,
        },
      },
    ],
    recordScimGroupMapping: async () => [],
    recordScimApplyFailure: async () => [],
    redriveScimApply: async () => [],
    revokeScimSync: async () => [],
  };
}

function directoryOver({ ledger }: { ledger: ScimSyncLedgerWriterService }) {
  const store = MemoryScimRepository.create();
  const users = {
    findById: vi.fn(async ({ id }) => store.users.get(id) ?? null),
    findByEmail: vi.fn(async () => null),
    create: vi.fn(async ({ name, email }) => {
      const created = {
        id: "user_1",
        name,
        email,
        emailVerified: true,
        image: null,
        pendingSsoSetup: false,
        createdAt: new Date(0),
        updatedAt: new Date(0),
        lastLoginAt: null,
        deactivatedAt: null,
      };
      store.users.set(created.id, created);

      return created;
    }),
  } satisfies ScimUserProvisioning;
  let commandIds = 0;

  return ScimService.create({
    prisma: store,
    writer: new GrantsFake(),
    users,
    governance: {
      departmentResolveByNameOrCreate: vi.fn(),
      departmentAssignUser: vi.fn(async () => undefined),
    },
    organization: new OrganizationAdministrationFake(),
    entitlements: new EnterpriseEntitlements(),
    lifecycle: ScimSyncLifecycleService.create({
      guards: guards(),
      ledger,
      newCommandId: () => `cmd_${(commandIds += 1)}`,
    }),
    provenOffboarding: false,
    tokenPepper: "scim-test-pepper",
  });
}

describe("given a deployment that configured no queue for the event stack", () => {
  describe("when an Enterprise directory pushes a person", () => {
    /** @scenario A process with no queue loses the directory-sync history loudly */
    it("provisions them anyway and records the lost history at error, naming the pipeline and sender", async () => {
      const { logger, lines } = createTestLogger();
      const ledger = ScimSyncLedgerWriterService.create({ logger });
      // A runtime with no command queue hands the pipeline no senders, so the
      // writer is never connected.
      const service = directoryOver({ ledger });

      const created = await service.createUser({
        organizationId: ORGANIZATION,
        connectionId: CONNECTION,
        request: {
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
          userName: "ada@acme.test",
          externalId: "okta-ada",
        },
      });

      expect(created).toMatchObject({ userName: "ada@acme.test", active: true });
      const line = lines.findLine("error", "scim-sync");
      expect(line).toMatchObject({
        connectionId: CONNECTION,
        pipeline: "scim-sync",
        senderName: "recordScimUserPush",
      });
    });
  });
});
