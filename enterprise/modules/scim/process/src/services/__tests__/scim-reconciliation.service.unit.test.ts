// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The organization's directory-sync panel, assembled from four owners
 * (ADR-122). What these pin is the composition and the words: no read here
 * touches a table another module owns, and nothing identity or authz holds
 * as a code reaches the reader as one.
 */
import type {
  OrganizationSsoConnection,
  ScimSyncActivityEntry,
  ScimSyncState,
} from "@langwatch/identity-contract";
import type { UserFullProfile } from "@langwatch/user-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { directoryFailureCopy } from "../../rules/scim-reconciliation-copy.rules.ts";
import {
  ScimReconciliationService,
  type ScimReconciliationReads,
} from "../scim-reconciliation.service.ts";

const ACME = "org_acme";
const ACME_OKTA = "conn_acme_okta";
const ACME_SECOND = "conn_acme_entra";
const GLOBEX_CONNECTION = "conn_globex";
const T0 = Date.UTC(2026, 8, 20, 9, 0, 0);

function connection(overrides: Partial<OrganizationSsoConnection> = {}): OrganizationSsoConnection {
  return {
    connectionId: ACME_OKTA,
    displayName: "okta",
    providerId: "okta",
    verifiedDomains: ["acme.com"],
    type: "oidc",
    state: "ACTIVE",
    replacesConnectionId: null,
    migrationPhase: null,
    ...overrides,
  };
}

function sync(overrides: Partial<ScimSyncState> = {}): ScimSyncState {
  return {
    scimSyncId: ACME_OKTA,
    connectionId: ACME_OKTA,
    organizationId: ACME,
    state: "SYNCING",
    lastPushedAtMs: T0 + 5_000,
    lastFailure: null,
    deadLetters: [],
    revokedCause: null,
    createdAtMs: T0,
    updatedAtMs: T0 + 5_000,
    ...overrides,
  };
}

function person(id: string, name: string): UserFullProfile {
  return {
    id,
    name,
    email: `${id}@acme.example`,
    emailVerified: true,
    image: null,
    pendingSsoSetup: false,
    createdAt: new Date(T0),
    updatedAt: new Date(T0),
    lastLoginAt: null,
    deactivatedAt: null,
    lastHomePath: null,
    tracesExplorerTourDismissedAt: null,
  };
}

type PanelReads = ScimReconciliationReads & {
  findForOrganization: ReturnType<typeof vi.fn>;
  getProvider: ReturnType<typeof vi.fn>;
  findActivity: ReturnType<typeof vi.fn>;
};

function createReads({
  connections = [
    connection(),
    connection({
      connectionId: ACME_SECOND,
      displayName: "entra",
      providerId: "entra",
      verifiedDomains: [],
    }),
  ],
  syncs = [sync()],
  ownership = Array.from({ length: 12 }, (_, index) => ({
    connectionId: ACME_OKTA,
    userId: `user_${index}`,
  })),
  changes = [
    {
      grantId: "grant_sam_member",
      userId: "user_sam",
      kind: "removed" as const,
      occurredAtMs: T0 + 4_000,
    },
  ],
  people = [
    ...Array.from({ length: 12 }, (_, index) => person(`user_${index}`, `Person ${index}`)),
    person("user_sam", "Sam Patel"),
  ],
  activity = [],
}: {
  connections?: OrganizationSsoConnection[];
  syncs?: ScimSyncState[];
  ownership?: { connectionId: string; userId: string }[];
  changes?: {
    grantId: string;
    userId: string | null;
    kind: "attached" | "removed";
    occurredAtMs: number;
  }[];
  people?: UserFullProfile[];
  activity?: ScimSyncActivityEntry[];
} = {}): PanelReads {
  const findForOrganization = vi.fn(async () => connections);
  const getProvider = vi.fn(async ({ connectionId }: { connectionId: string }) => ({
    connectionId,
    providerId: "never asked",
  }));

  const findActivity = vi.fn(async () => activity);

  return {
    findForOrganization,
    getProvider,
    findActivity,
    identity: {
      ssoConnectionReads: () => ({
        findForOrganization,
        getProvider,
        getOrganization: () => Promise.reject(new Error("reconciliation never asks")),
      }),
      scimSyncReads: () => ({
        findForOrganization: async () => syncs,
        findByConnection: async () => null,
        listForOperator: async () => ({ syncs: [], total: 0 }),
        findForOperator: async () => [],
        findActivity,
      }),
    },
    grants: { findDirectoryCausedChanges: vi.fn(async () => changes) },
    people: { getProfiles: vi.fn(async () => people) },
    directory: { findDirectoryOwnership: vi.fn(async () => ownership) },
  };
}

describe("the organization's directory sync panel", () => {
  let reads: PanelReads;
  let service: ScimReconciliationService;

  beforeEach(() => {
    reads = createReads();
    service = ScimReconciliationService.create(reads);
  });

  describe("when an administrator reads their organization's connections", () => {
    /** @scenario "Reissuing a directory token preserves evidence of earlier changes" */
    it("distinguishes a fresh token from a reissued token without clearing the last change", async () => {
      service = ScimReconciliationService.create(
        createReads({
          syncs: [
            sync({ state: "TOKEN_ISSUED", lastPushedAtMs: null }),
            sync({
              scimSyncId: ACME_SECOND,
              connectionId: ACME_SECOND,
              state: "TOKEN_ISSUED",
            }),
          ],
        }),
      );

      const panel = await service.getAll({ organizationId: ACME });

      expect(panel.connections.find((entry) => entry.connectionId === ACME_OKTA)).toMatchObject({
        lastPushedAtMs: null,
        status: {
          headline: "Waiting for the first push",
          waitingFor: expect.stringContaining("first push"),
          tone: "waiting",
        },
      });
      expect(panel.connections.find((entry) => entry.connectionId === ACME_SECOND)).toMatchObject({
        lastPushedAtMs: T0 + 5_000,
        status: {
          headline: "Waiting for the next change",
          waitingFor: expect.stringContaining("the next change it sends"),
          tone: "waiting",
        },
      });
    });

    it("names each connection's state in words rather than in a code", async () => {
      const panel = await service.getAll({ organizationId: ACME });

      const okta = panel.connections.find((entry) => entry.connectionId === ACME_OKTA);
      expect(okta?.state).toBe("SYNCING");
      expect(okta?.status.headline).toBe("Syncing");
      expect(okta?.status.waitingFor).toMatch(/pushing changes/i);
      expect(okta?.status.waitingFor).not.toMatch(/SYNCING|TOKEN_ISSUED/);
    });

    it("names each connection's provider and domains from the one list read", async () => {
      const panel = await service.getAll({ organizationId: ACME });

      expect(panel.connections.map((entry) => entry.providerId)).toEqual(["okta", "entra"]);
      expect(panel.connections.map((entry) => entry.verifiedDomains)).toEqual([["acme.com"], []]);
      expect(reads.getProvider).not.toHaveBeenCalled();
    });

    it("counts the last push and the people the directory manages, per connection", async () => {
      const panel = await service.getAll({ organizationId: ACME });

      const okta = panel.connections.find((entry) => entry.connectionId === ACME_OKTA);
      expect(okta?.lastPushedAtMs).toBe(T0 + 5_000);
      expect(okta?.managedPeople).toBe(12);

      const entra = panel.connections.find((entry) => entry.connectionId === ACME_SECOND);
      expect(entra?.managedPeople).toBe(0);
    });

    it("counts a person the product has erased out of what the directory manages", async () => {
      service = ScimReconciliationService.create(
        createReads({
          ownership: [
            { connectionId: ACME_OKTA, userId: "user_here" },
            { connectionId: ACME_OKTA, userId: "user_erased" },
          ],
          people: [person("user_here", "Still Here")],
        }),
      );

      const panel = await service.getAll({ organizationId: ACME });

      expect(
        panel.connections.find((entry) => entry.connectionId === ACME_OKTA)?.managedPeople,
      ).toBe(1);
    });

    it("reads a connection with no sync yet as waiting, and not as an error", async () => {
      const panel = await service.getAll({ organizationId: ACME });

      const untouched = panel.connections.find((entry) => entry.connectionId === ACME_SECOND);
      expect(untouched?.state).toBeNull();
      expect(untouched?.status.tone).toBe("waiting");
      expect(untouched?.lastPushedAtMs).toBeNull();
      expect(untouched?.failures).toEqual([]);
      expect(untouched?.status.headline).toBe("Not set up yet");
    });
  });

  describe("when the directory has removed somebody", () => {
    it("lists them with the directory named as the author and when it happened", async () => {
      const panel = await service.getAll({ organizationId: ACME });

      expect(panel.recentChanges).toEqual([
        {
          grantId: "grant_sam_member",
          summary: "Sam Patel lost access",
          author: "Your identity provider",
          occurredAtMs: T0 + 4_000,
          kind: "removed",
        },
      ]);
    });

    /** @scenario "A directory-caused change and the audit page tell the same story" */
    it("names the same recorded fact the grants ledger names for that change", async () => {
      const panel = await service.getAll({ organizationId: ACME });

      expect(panel.recentChanges[0]?.grantId).toBe("grant_sam_member");
    });
  });

  describe("when a failed apply is standing", () => {
    beforeEach(() => {
      const failure = {
        op: "deactivate_user" as const,
        errorCode: "offboard_incomplete",
        attempts: 5,
        retiredAtMs: T0 + 6_000,
        userId: "user_sam",
        occurredAtMs: T0 + 6_000,
        redrivenAtMs: null,
      };
      service = ScimReconciliationService.create(
        createReads({
          syncs: [sync({ state: "ERROR", lastFailure: failure, deadLetters: [failure] })],
        }),
      );
    });

    it("says what happened and what resolves it, and shows no code or record identifier", async () => {
      const panel = await service.getAll({ organizationId: ACME });
      const okta = panel.connections.find((entry) => entry.connectionId === ACME_OKTA);

      expect(okta?.failures).toHaveLength(1);
      const failure = okta?.failures[0];
      expect(failure?.title).not.toContain("offboard_incomplete");
      expect(failure?.description.length).toBeGreaterThan(0);
      expect(failure?.retired).toBe(true);
      expect(JSON.stringify(okta)).not.toContain("offboard_incomplete");
      expect(JSON.stringify(okta)).not.toContain("user_sam");
    });

    it("offers no re-run, and says the directory's next push is what re-asserts it", async () => {
      const panel = await service.getAll({ organizationId: ACME });
      const okta = panel.connections.find((entry) => entry.connectionId === ACME_OKTA);

      expect(Object.keys(okta ?? {})).not.toContain("retry");
      expect(okta?.remediation).toMatch(/next push re-asserts/i);
    });
  });

  describe("given a connection that belongs to another organization", () => {
    /** @scenario "Another organization's connection is not there to read" */
    it("lists nothing of theirs, because the read was built from this organization", async () => {
      const panel = await service.getAll({ organizationId: ACME });

      expect(panel.connections.map((entry) => entry.connectionId)).toEqual([
        ACME_OKTA,
        ACME_SECOND,
      ]);
      expect(panel.connections.map((entry) => entry.connectionId)).not.toContain(GLOBEX_CONNECTION);
      expect(reads.findForOrganization).toHaveBeenCalledWith({ organizationId: ACME });
    });
  });

  describe("when the panel reads recent directory changes", () => {
    /** @scenario "Recent directory removals survive a full page of live grants" */
    it("asks the grants ledger for the whole recent window rather than a page of live rows", async () => {
      await service.getAll({ organizationId: ACME });

      expect(reads.grants.findDirectoryCausedChanges).toHaveBeenCalledWith({
        organizationId: ACME,
        limit: 50,
      });
    });
  });

  describe("when an administrator reads what the directory has been doing", () => {
    const at = (offsetMs: number) => T0 + offsetMs;
    const entry = (overrides: Partial<ScimSyncActivityEntry>): ScimSyncActivityEntry => ({
      eventId: "evt",
      type: "lw.identity.scim_user_pushed",
      occurredAtMs: at(0),
      outcome: "ok",
      userId: null,
      externalId: null,
      groupId: null,
      op: null,
      errorCode: null,
      ...overrides,
    });

    /** @scenario "A push and the failure after it read as the directory's acts, in words" */
    it("words each line as the directory's act, naming the person and the failure", async () => {
      reads = createReads({
        activity: [
          entry({
            eventId: "evt_failed",
            type: "lw.identity.scim_apply_failed",
            occurredAtMs: at(2_000),
            outcome: "refused",
            userId: "user_sam",
            op: "push_user",
            errorCode: "scim_unknown_failure_code",
          }),
          entry({ eventId: "evt_pushed", userId: "user_sam", op: "deactivate" }),
          entry({ eventId: "evt_stranger", userId: "user_gone", op: "create" }),
        ],
      });
      service = ScimReconciliationService.create(reads);

      const activity = await service.findActivity({
        organizationId: ACME,
        connectionId: ACME_OKTA,
      });

      expect(activity.map((line) => [line.eventId, line.outcome])).toEqual([
        ["evt_failed", "refused"],
        ["evt_pushed", "ok"],
        ["evt_stranger", "ok"],
      ]);
      expect(activity[0]?.summary).toBe(directoryFailureCopy("scim_unknown_failure_code").title);
      expect(activity[1]?.summary).toBe("Your directory switched off access for Sam Patel");
      expect(activity[2]?.summary).toBe("Your directory added a person");
      expect(reads.findActivity).toHaveBeenCalledWith({
        organizationId: ACME,
        connectionId: ACME_OKTA,
        limit: 25,
      });
    });

    it("names each person once, however many lines are about them", async () => {
      reads = createReads({
        activity: [
          entry({ eventId: "evt_1", userId: "user_sam", op: "create" }),
          entry({ eventId: "evt_2", userId: "user_sam", op: "update" }),
        ],
      });
      service = ScimReconciliationService.create(reads);

      await service.findActivity({ organizationId: ACME, connectionId: ACME_OKTA });

      expect(reads.people.getProfiles).toHaveBeenCalledTimes(1);
      expect(reads.people.getProfiles).toHaveBeenCalledWith({ userIds: ["user_sam"] });
    });
  });
});
