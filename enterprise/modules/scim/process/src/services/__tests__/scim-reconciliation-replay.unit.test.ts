// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Rebuilding the directory-sync projection from its event log leaves both
 * reconciliation views showing what they showed before the rebuild.
 * @see enterprise/modules/scim/specs/scim-reconciliation-surfaces.feature
 */
import {
  SCIM_APPLY_FAILED_EVENT_TYPE,
  SCIM_APPLY_RECOVERED_EVENT_TYPE,
  SCIM_APPLY_RETIRED_EVENT_TYPE,
  SCIM_TOKEN_ISSUED_EVENT_TYPE,
  SCIM_USER_PUSHED_EVENT_TYPE,
  type ScimSyncState,
} from "@langwatch/enterprise-scim-contract";
import { createTenantId } from "@langwatch/eventing";
import type { OrganizationSsoConnection } from "@langwatch/identity-contract";
import { describe, expect, it } from "vitest";

import {
  ScimSyncStateFoldProjection,
  type ScimSyncFoldState,
} from "../../eventing/scim-sync-state.projection.ts";
import { ScimSyncReadRepository } from "../../repositories/scim-sync.repository.ts";
import {
  ScimReconciliationService,
  type ScimReconciliationReads,
} from "../scim-reconciliation.service.ts";
import { ScimSyncReadsService } from "../scim-sync-reads.service.ts";

const ACME = "org_acme";
const CONNECTION = "conn_acme_okta";
const SYNC = "scimsync_conn_acme_okta";
const T0 = Date.UTC(2026, 8, 20, 9, 0, 0);
const IDENTITY = { scimSyncId: SYNC, connectionId: CONNECTION, organizationId: ACME };

let eventNumber = 0;

function logged({ type, data, at }: { type: string; data: object; at: number }) {
  eventNumber += 1;

  return {
    id: `evt_${eventNumber}`,
    aggregateId: SYNC,
    aggregateType: "scim_sync",
    tenantId: createTenantId(ACME),
    createdAt: at,
    occurredAt: at,
    type,
    version: "2026-08-24",
    data,
  };
}

/** A token issued, people pushed, a failure that recovered and one that was retired. */
const EVENT_LOG = [
  logged({
    type: SCIM_TOKEN_ISSUED_EVENT_TYPE,
    at: T0,
    data: { ...IDENTITY, tokenId: "tok_1", actor: { type: "system", id: null } },
  }),
  logged({
    type: SCIM_USER_PUSHED_EVENT_TYPE,
    at: T0 + 1_000,
    data: { ...IDENTITY, userId: "user_ada", externalId: "okta-ada", op: "create" },
  }),
  logged({
    type: SCIM_APPLY_FAILED_EVENT_TYPE,
    at: T0 + 2_000,
    data: {
      ...IDENTITY,
      op: "push_user",
      errorCode: "email_taken",
      retryable: true,
      userId: "user_bob",
    },
  }),
  logged({
    type: SCIM_APPLY_RECOVERED_EVENT_TYPE,
    at: T0 + 3_000,
    data: { ...IDENTITY, op: "push_user" },
  }),
  logged({
    type: SCIM_APPLY_FAILED_EVENT_TYPE,
    at: T0 + 4_000,
    data: {
      ...IDENTITY,
      op: "deactivate_user",
      errorCode: "last_admin",
      retryable: false,
      userId: "user_cy",
    },
  }),
  logged({
    type: SCIM_APPLY_RETIRED_EVENT_TYPE,
    at: T0 + 4_000,
    data: {
      ...IDENTITY,
      op: "deactivate_user",
      errorCode: "last_admin",
      attempts: 1,
      userId: "user_cy",
    },
  }),
];

function projection() {
  return ScimSyncStateFoldProjection.create({
    store: { store: async () => undefined, get: async () => null },
  } as never);
}

/** The row the projection keeps, without the base class's wall-clock stamps. */
function rowOf(folded: ScimSyncFoldState): ScimSyncState {
  const { CreatedAt, UpdatedAt, LastEventOccurredAt, ...row } = folded;
  void [CreatedAt, UpdatedAt, LastEventOccurredAt];

  return row;
}

/** Applied one event at a time, each state written and read back as the store would. */
function liveRow(): ScimSyncState {
  const fold = projection();
  let stored = JSON.parse(JSON.stringify(fold.init())) as ScimSyncFoldState;
  for (const event of EVENT_LOG) {
    stored = JSON.parse(JSON.stringify(fold.apply(stored, event))) as ScimSyncFoldState;
  }

  return rowOf(stored);
}

/** Dropped, then folded from the log's first event with nothing carried over. */
function rebuiltRow(): ScimSyncState {
  const fold = projection();

  return rowOf(EVENT_LOG.reduce((state, event) => fold.apply(state, event), fold.init()));
}

const OKTA: OrganizationSsoConnection = {
  connectionId: CONNECTION,
  displayName: "okta",
  providerId: "okta",
  verifiedDomains: ["acme.com"],
  type: "oidc",
  state: "ACTIVE",
  replacesConnectionId: null,
  migrationPhase: null,
};

function orgViewOver({ row }: { row: ScimSyncState }) {
  const reads: ScimReconciliationReads = {
    identity: {
      ssoConnectionReads: () => ({
        findForOrganization: async () => [OKTA],
        getProvider: async () => ({ connectionId: CONNECTION, providerId: "okta" }),
        getOrganization: () => Promise.reject(new Error("reconciliation never asks")),
      }),
    },
    syncs: {
      findForOrganization: async () => [row],
      findByConnection: async () => row,
      findActivity: async () => [],
    },
    grants: { findDirectoryCausedChanges: async () => [] },
    people: { getProfiles: async () => [] },
    directory: {
      findDirectoryOwnership: async () => [{ connectionId: CONNECTION, userId: "user_ada" }],
    },
  } as never;

  return ScimReconciliationService.create(reads);
}

function opsViewOver({ row }: { row: ScimSyncState }) {
  class RowSyncs extends ScimSyncReadRepository {
    async getSync(): Promise<ScimSyncState> {
      return row;
    }
    async listPageForOperator(): Promise<{ syncs: ScimSyncState[]; total: number }> {
      return { syncs: [row], total: 1 };
    }
    async findByConnectionForOperator(): Promise<ScimSyncState[]> {
      return [row];
    }
    async findForOrganization(): Promise<ScimSyncState[]> {
      return [row];
    }
  }

  return ScimSyncReadsService.create({ syncs: new RowSyncs(), activity: null });
}

describe("given both reconciliation views have been read for an organization", () => {
  describe("when the directory-sync projection is rebuilt from the event log", () => {
    /** @scenario Replay rebuilds everything the views show */
    it("shows the same organization view and the same operator view as the live projection did", async () => {
      const live = liveRow();
      const rebuilt = rebuiltRow();

      const liveOrgView = await orgViewOver({ row: live }).getAll({ organizationId: ACME });
      const liveOpsView = await opsViewOver({ row: live }).listForOperator({
        page: 1,
        pageSize: 10,
      });
      const rebuiltOrgView = await orgViewOver({ row: rebuilt }).getAll({ organizationId: ACME });
      const rebuiltOpsView = await opsViewOver({ row: rebuilt }).listForOperator({
        page: 1,
        pageSize: 10,
      });

      // The views are not empty: the log left a standing failure and a dead letter to show.
      expect(live).toMatchObject({ state: "ERROR", lastPushedAtMs: T0 + 1_000 });
      expect(live.deadLetters).toHaveLength(1);
      expect(rebuilt).toEqual(live);
      expect(rebuiltOrgView).toEqual(liveOrgView);
      expect(rebuiltOpsView).toEqual(liveOpsView);
    });
  });
});
