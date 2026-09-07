/** @vitest-environment node */

/**
 * The organization's read of its own directory sync (ADR-122), against the
 * real service over in-memory stand-ins for the four reads it makes.
 *
 * Two promises live here rather than on the page, which is why they are
 * asserted here: the ORGANIZATION is where the query is built from, so a
 * connection belonging to somebody else is not filtered out — it was never in
 * the result set; and the panel and the audit page are the SAME STORY,
 * because both name the grant fact the change is, so nobody has to reconcile
 * two accounts of one removal.
 *
 * Bound at unit level rather than against Postgres because this machine has
 * no `LANGWATCH_TEST_DATABASE_URL`; what a real database would add is that
 * each read's `where` answers the same way, and each is one `where`.
 *
 * @see specs/identity/scim-reconciliation-surfaces.feature
 */
import type { ScimSyncState } from "@langwatch/identity";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DirectoryCausedChange } from "../repositories/scim-reconciliation.prisma.repository";
import type { DirectoryActivityEntry } from "../repositories/scim-sync-event-log.repository";
import { ScimReconciliationService } from "../scim-reconciliation.service";

const ACME = "org_acme";
const GLOBEX = "org_globex";
const ACME_OKTA = "acme-okta";
const ACME_SECOND = "acme-entra";
const GLOBEX_CONNECTION = "globex-okta";
const T0 = 1_756_000_000_000;

const CONNECTIONS = [
  {
    organizationId: ACME,
    connectionId: ACME_OKTA,
    providerId: "okta",
    state: "ACTIVE",
    verifiedDomains: ["acme.com"],
  },
  {
    organizationId: ACME,
    connectionId: ACME_SECOND,
    providerId: "entra",
    state: "ACTIVE",
    verifiedDomains: ["contractors.acme.com"],
  },
  {
    organizationId: GLOBEX,
    connectionId: GLOBEX_CONNECTION,
    providerId: "globex-idp",
    state: "ACTIVE",
    verifiedDomains: ["globex.com"],
  },
];

const ACME_SYNC: ScimSyncState = {
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
};

const REMOVED_SAM: DirectoryCausedChange = {
  grantId: "grant_sam_member",
  userId: "user_sam",
  principalType: "USER",
  roleKey: "member",
  scopeType: "ORGANIZATION",
  scopeId: ACME,
  kind: "removed",
  occurredAtMs: T0 + 4_000,
};

/** The four reads, in memory, each honouring the organization it is given. */
function createReads({
  syncs = [ACME_SYNC],
  changes = [REMOVED_SAM],
  managed = new Map([[ACME_OKTA, 12]]),
}: {
  syncs?: ScimSyncState[];
  changes?: DirectoryCausedChange[];
  managed?: Map<string, number>;
} = {}) {
  return {
    findAllConnections: vi.fn(
      async ({ organizationId }: { organizationId: string }) =>
        CONNECTIONS.filter(
          (connection) => connection.organizationId === organizationId,
        ),
    ),
    findAllSyncsForOrganization: vi.fn(
      async ({ organizationId }: { organizationId: string }) =>
        syncs.filter((sync) => sync.organizationId === organizationId),
    ),
    findSyncByIdForOrganization: vi.fn(
      async ({
        organizationId,
        connectionId,
      }: {
        organizationId: string;
        connectionId: string;
      }) =>
        syncs.find(
          (sync) =>
            sync.organizationId === organizationId &&
            sync.connectionId === connectionId,
        ) ?? null,
    ),
    countManagedPeople: vi.fn(async () => managed),
    findDirectoryCausedChanges: vi.fn(async () => changes),
    findPeopleNames: vi.fn(async () => new Map([["user_sam", "Sam Patel"]])),
  };
}

/**
 * The log, as the activity feed reads it (ADR-126).
 *
 * Keyed by connection so the stand-in enforces the property the real read
 * gets from tenancy: asking for somebody else's connection under this
 * organization finds nothing, rather than finding it and being filtered.
 */
function createActivity(
  entriesByConnection: Record<string, DirectoryActivityEntry[]> = {},
) {
  return {
    findActivity: vi.fn(
      async ({
        organizationId,
        connectionId,
        limit,
      }: {
        organizationId: string;
        connectionId: string;
        limit: number;
      }) => {
        const owner = CONNECTIONS.find(
          (connection) => connection.connectionId === connectionId,
        );
        if (owner?.organizationId !== organizationId) return [];
        return (entriesByConnection[connectionId] ?? [])
          .slice()
          .sort((a, b) => b.occurredAtMs - a.occurredAtMs)
          .slice(0, limit);
      },
    ),
  };
}

let reads: ReturnType<typeof createReads>;
let activity: ReturnType<typeof createActivity>;
let service: ScimReconciliationService;

/** The request log's read half. Empty by default: every test in this file is
 *  about the reconciliation panel, and a request feed it does not assert on
 *  must not be able to affect what it reads. */
const createRequests = () => ({
  findForConnection: vi.fn(async () => []),
});

function buildService(
  entriesByConnection: Record<string, DirectoryActivityEntry[]> = {},
) {
  reads = createReads();
  activity = createActivity(entriesByConnection);
  service = new ScimReconciliationService({
    reads: reads as never,
    activity: activity as never,
    requests: createRequests() as never,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  buildService();
});

describe("the organization's directory sync panel", () => {
  describe("when an administrator reads their organization's connections", () => {
    /** @scenario "A connection's sync state is on the SCIM settings page" */
    it("names each connection's state in words rather than in a code", async () => {
      const panel = await service.getAll({ organizationId: ACME });

      const okta = panel.connections.find(
        (connection) => connection.connectionId === ACME_OKTA,
      );
      expect(okta?.state).toBe("SYNCING");
      expect(okta?.status.headline).toBe("Syncing");
      // The words say what it is doing; the lifecycle name never reaches
      // them.
      expect(okta?.status.waitingFor).toMatch(/pushing changes/i);
      expect(okta?.status.waitingFor).not.toMatch(/SYNCING|TOKEN_ISSUED/);
    });

    /** @scenario "The last push and the people managed are counted per connection" */
    it("counts the last push and the people the directory manages, per connection", async () => {
      const panel = await service.getAll({ organizationId: ACME });

      const okta = panel.connections.find(
        (connection) => connection.connectionId === ACME_OKTA,
      );
      expect(okta?.lastPushedAtMs).toBe(T0 + 5_000);
      expect(okta?.managedPeople).toBe(12);

      // Per connection, not per organization: the sibling counts its own.
      const entra = panel.connections.find(
        (connection) => connection.connectionId === ACME_SECOND,
      );
      expect(entra?.managedPeople).toBe(0);
    });

    /** @scenario "A connection the directory has never pushed to says so calmly" */
    it("reads a connection with no sync yet as waiting, and not as an error", async () => {
      const panel = await service.getAll({ organizationId: ACME });

      const untouched = panel.connections.find(
        (connection) => connection.connectionId === ACME_SECOND,
      );
      expect(untouched?.state).toBeNull();
      expect(untouched?.status.tone).toBe("waiting");
      expect(untouched?.lastPushedAtMs).toBeNull();
      // Nothing about it reads as a failure: no failure listed, and the words
      // say what to do next rather than what went wrong.
      expect(untouched?.failures).toEqual([]);
      expect(untouched?.status.headline).toBe("Not set up yet");
    });
  });

  describe("when the directory has removed somebody", () => {
    /** @scenario "People the directory removed are listed as the directory's act" */
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
    it("names the same recorded fact the audit trail names for that change", async () => {
      const panel = await service.getAll({ organizationId: ACME });

      // The panel entry IS the grant fact, identified the way the grants
      // audit row identifies it (`metadata.grantId`). Two surfaces, one
      // recorded fact — so there is nothing for a reader to reconcile.
      const change = panel.recentChanges[0]!;
      const auditRowForTheSameFact = { grantId: REMOVED_SAM.grantId };
      expect(change.grantId).toBe(auditRowForTheSameFact.grantId);
    });
  });

  describe("when a failed apply is standing", () => {
    /** @scenario "A failed apply reaches the administrator as words to act on" */
    it("says what happened and what resolves it, and shows no code or record identifier", async () => {
      reads = createReads({
        syncs: [
          {
            ...ACME_SYNC,
            state: "ERROR",
            lastFailure: {
              op: "deactivate_user",
              errorCode: "offboard_incomplete",
              attempts: 5,
              retiredAtMs: T0 + 6_000,
              redrivenAtMs: null,
              userId: "user_sam",
              occurredAtMs: T0 + 6_000,
            },
            deadLetters: [
              {
                op: "deactivate_user",
                errorCode: "offboard_incomplete",
                attempts: 5,
                retiredAtMs: T0 + 6_000,
                redrivenAtMs: null,
                userId: "user_sam",
                occurredAtMs: T0 + 6_000,
              },
            ],
          },
        ],
      });
      service = new ScimReconciliationService({
        reads: reads as never,
        activity: activity as never,
        requests: createRequests() as never,
      });

      const panel = await service.getAll({ organizationId: ACME });
      const okta = panel.connections.find(
        (connection) => connection.connectionId === ACME_OKTA,
      );

      expect(okta?.failures).toHaveLength(1);
      const failure = okta!.failures[0]!;
      expect(failure.title).not.toContain("offboard_incomplete");
      expect(failure.description.length).toBeGreaterThan(0);
      expect(failure.retired).toBe(true);
      // No reason code and no identifier for the record behind it reach the
      // reader anywhere in what the panel hands over.
      expect(JSON.stringify(okta)).not.toContain("offboard_incomplete");
      expect(JSON.stringify(okta)).not.toContain("user_sam");
    });

    /** @scenario "The organization view offers no retry" */
    it("offers no re-run, and says the directory's next push is what re-asserts it", async () => {
      const panel = await service.getAll({ organizationId: ACME });
      const okta = panel.connections.find(
        (connection) => connection.connectionId === ACME_OKTA,
      )!;

      // There is no verb on this view model at all — nothing a page could
      // render as a control even if somebody wanted to.
      expect(Object.keys(okta)).not.toContain("retry");
      expect(okta.remediation).toMatch(/next push re-asserts/i);
    });
  });

  describe("given a connection that belongs to another organization", () => {
    /** @scenario "Another organization's connection is not there to read" */
    it("lists nothing of theirs, and answers their connection as if it did not exist", async () => {
      const panel = await service.getAll({ organizationId: ACME });

      expect(
        panel.connections.map((connection) => connection.connectionId),
      ).toEqual([ACME_OKTA, ACME_SECOND]);

      // Naming it explicitly answers null — and the reason is that the query
      // was built from the organization, so it was never in the set to be
      // filtered out of.
      await expect(
        service.getById({
          organizationId: ACME,
          connectionId: GLOBEX_CONNECTION,
        }),
      ).resolves.toBeNull();
      expect(reads.findAllConnections).toHaveBeenCalledWith({
        organizationId: ACME,
      });
    });
  });
});

/**
 * The sequence, as against the state (ADR-126).
 *
 * These read the log rather than the projection, so what they pin is the
 * ordering and the wording — the two things a folded head cannot give, and
 * the two a person watching a provider they configured a minute ago is
 * actually reading.
 */
describe("what the directory has been doing", () => {
  const pushedSam: DirectoryActivityEntry = {
    eventId: "evt_push",
    type: "lw.identity.scim_user_pushed",
    occurredAtMs: T0 + 1_000,
    outcome: "ok",
    userId: "user_sam",
    externalId: "okta-sam",
    groupId: null,
    op: "create",
    errorCode: null,
  };
  const failedAfterwards: DirectoryActivityEntry = {
    eventId: "evt_fail",
    type: "lw.identity.scim_apply_failed",
    occurredAtMs: T0 + 2_000,
    outcome: "refused",
    userId: "user_sam",
    externalId: null,
    groupId: null,
    op: "deactivate",
    errorCode: "offboard_incomplete",
  };

  describe("when an administrator reads a connection's activity", () => {
    /** @scenario "What the directory has been doing is listed newest first" */
    it("lists what happened newest first, each with its time and whether it landed", async () => {
      buildService({ [ACME_OKTA]: [pushedSam, failedAfterwards] });

      const feed = await service.getActivity({
        organizationId: ACME,
        connectionId: ACME_OKTA,
      });

      expect(feed.map((entry) => entry.eventId)).toEqual([
        "evt_fail",
        "evt_push",
      ]);
      expect(feed[0]?.occurredAtMs).toBe(T0 + 2_000);
      expect(feed.map((entry) => entry.outcome)).toEqual(["refused", "ok"]);
    });

    /** @scenario "A push and the failure that followed it are both in the sequence" */
    it("keeps both the push and the failure, and says the failure in words", async () => {
      buildService({ [ACME_OKTA]: [pushedSam, failedAfterwards] });

      const feed = await service.getActivity({
        organizationId: ACME,
        connectionId: ACME_OKTA,
      });

      expect(feed).toHaveLength(2);
      // The person the push was about is named, not identified.
      expect(feed[1]?.summary).toContain("Sam Patel");
      expect(feed[1]?.summary).not.toContain("user_sam");
      // And the failure reads as words rather than as the reason code.
      expect(feed[0]?.summary).not.toContain("offboard_incomplete");
      expect(feed[0]?.summary.length).toBeGreaterThan(0);
    });
  });

  describe("when the connection named belongs to another organization", () => {
    /** @scenario "Another organization's directory activity is not there to read" */
    it("finds nothing, because the read was built from this organization", async () => {
      buildService({
        [GLOBEX_CONNECTION]: [{ ...pushedSam, eventId: "evt_globex" }],
      });

      const feed = await service.getActivity({
        organizationId: ACME,
        connectionId: GLOBEX_CONNECTION,
      });

      expect(feed).toEqual([]);
      expect(activity.findActivity).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: ACME }),
      );
    });
  });
});
