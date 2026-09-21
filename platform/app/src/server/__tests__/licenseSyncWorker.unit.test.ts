/**
 * The daily license sync of a connected install.
 *
 * Driven through a fake connect host and a fake clock: what the install sends,
 * what it keeps of the answer, and what it does when the answer, the license
 * in it, or the host itself cannot be trusted.
 *
 * @see ../licenseSyncWorker.ts
 * @see specs/self-hosting/connected-services/license-sync.feature
 */

import {
  credentialOf,
  INSTANCE_ID,
  instanceIdentityTable,
  LANGWATCH_KEYS,
  LICENSE,
  leaseFor,
  mintLicense,
  NOW,
  ORGANIZATION_ID,
  STRANGER_KEYS,
  tamperedLease,
} from "@ee/licensing/connect/install/__tests__/installFakes";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ILicenseEnforcementRepository } from "~/server/license-enforcement/license-enforcement.repository";

vi.mock("~/server/db", () => ({ prisma: {} }));

vi.mock("~/server/app-layer/app", () => ({
  tryGetApp: () => null,
  getApp: () => ({
    dataRetention: {
      policy: {
        listOrganizationRules: async () => [],
        setForScope: async () => undefined,
      },
    },
  }),
}));

vi.mock("~/utils/posthogErrorCapture", () => ({
  captureException: vi.fn(),
  toError: (error: unknown) =>
    error instanceof Error ? error : new Error(String(error)),
  withScope: async (run: (scope: unknown) => Promise<void>) => await run({}),
}));

const { connectEnabled, entitled } = vi.hoisted(() => ({
  connectEnabled: { current: true },
  entitled: { current: true },
}));

vi.mock("@ee/licensing/connect/install/connectConfig", () => ({
  readConnectConfig: () => ({
    permitted: connectEnabled.current,
    gatewayEndpoint: "https://gateway.example.test",
    licenseEndpoint: "https://connect.example.test",
  }),
}));

// Which licenses name a hosted service is read out of the signed blob, and
// that has its own suite. Here every license in the fixture rows is entitled
// unless a test says otherwise, so what is pinned is what the sync does with
// the organizations it was given.
vi.mock("@ee/licensing/connect/install/connectEntitlement", () => ({
  licenseConnectServices: ({ licenseKey }: { licenseKey: string | null }) =>
    licenseKey && entitled.current ? ["instant_evals"] : [],
}));

import {
  readInstallVersion,
  startLicenseSyncWorker,
  syncLicensesForAllOrganizations,
} from "../licenseSyncWorker";

const LEASE = leaseFor({ seatOverageAllowance: 5 });

interface Updated {
  connectLease?: unknown;
  connectLastSyncAt?: Date;
  connectLastSyncError?: string | null;
  license?: string;
}

function fakePrisma({ license = LICENSE.licenseKey as string | null } = {}) {
  const updates: Updated[] = [];
  let stored = license;
  return {
    updates,
    get storedLicense() {
      return stored;
    },
    client: {
      organization: {
        findMany: vi.fn(async () => [{ id: ORGANIZATION_ID, license: stored }]),
        findUnique: vi.fn(async () => ({
          id: ORGANIZATION_ID,
          license: stored,
        })),
        update: vi.fn(async ({ data }: { data: Updated }) => {
          updates.push(data);
          if (typeof data.license === "string") stored = data.license;
          return {};
        }),
      },
      // The credential now carries the install's own identity rather than an
      // organization id, so a sync reaches for this table. Held at the fixture
      // id, because the leases these tests verify were signed for it.
      instanceIdentity: instanceIdentityTable(),
    } as never,
  };
}

function fakeRepository(
  members = 53,
  liteMembers = 4,
): ILicenseEnforcementRepository {
  return {
    getMemberCount: vi.fn().mockResolvedValue(members),
    getMembersLiteCount: vi.fn().mockResolvedValue(liteMembers),
    getCurrentMonthCost: vi.fn(),
    getCurrentMonthCostForProjects: vi.fn(),
  };
}

/** A connect host that answers each sync in turn. */
function fakeClient(...answers: { lease: unknown; license?: string }[]) {
  const sent: unknown[] = [];
  let call = 0;
  return {
    sent,
    client: {
      syncLicense: vi.fn(async (request: unknown) => {
        sent.push(request);
        const answer = answers[Math.min(call, answers.length - 1)];
        call += 1;
        if (!answer) throw new Error("the suite named no answer");
        return answer;
      }),
    } as never,
  };
}

/** A connect host that refuses. */
function refusingClient(error: unknown) {
  return {
    syncLicense: vi.fn(async () => {
      throw error;
    }),
  } as never;
}

function run({
  prisma,
  client,
  repository = fakeRepository(),
}: {
  prisma: ReturnType<typeof fakePrisma>;
  client: ReturnType<typeof fakeClient>["client"];
  repository?: ILicenseEnforcementRepository;
}) {
  return syncLicensesForAllOrganizations({
    prisma: prisma.client,
    client,
    repository,
    publicKey: LANGWATCH_KEYS.publicKey,
    version: "3.17.0",
    now: () => NOW,
  });
}

beforeEach(() => {
  connectEnabled.current = true;
});

describe("given a connected install with a registered license", () => {
  describe("when the daily sync runs", () => {
    /** @scenario "The sync sends the fixed license payload and nothing else" */
    it("sends the token, the instance id, the version and the seats in use", async () => {
      const prisma = fakePrisma();
      const host = fakeClient({ lease: LEASE });

      await run({ prisma, client: host.client });

      expect(host.sent).toHaveLength(1);
      expect(host.sent[0]).toMatchObject({
        credential: {
          token: credentialOf(LICENSE.licenseKey).token,
          instanceId: INSTANCE_ID,
        },
        version: "3.17.0",
        seats: { members: 53, liteMembers: 4 },
      });
    });

    /** @scenario "A lease with a valid signature is applied" */
    it("stores the lease, its allowance and the services it names", async () => {
      const prisma = fakePrisma();

      await run({ prisma, client: fakeClient({ lease: LEASE }).client });

      const written = prisma.updates.at(-1);
      expect(written?.connectLease).toEqual(LEASE);
      expect(written?.connectLastSyncAt).toEqual(NOW);
      expect(written?.connectLastSyncError).toBeNull();
      expect(LEASE.payload.seatOverageAllowance).toBe(5);
      expect(LEASE.payload.services).toEqual(["instant_evals"]);
    });
  });

  describe("when a lease was edited after signing", () => {
    /** @scenario "A lease that was tampered with is ignored" */
    it("keeps the sync time but stores no lease, so the previous one stays", async () => {
      const prisma = fakePrisma();

      await run({
        prisma,
        client: fakeClient({ lease: tamperedLease(LEASE) }).client,
      });

      const written = prisma.updates.at(-1);
      expect(written).not.toHaveProperty("connectLease");
      expect(written?.connectLastSyncError).toBeNull();
    });
  });

  describe("when a lease names another license", () => {
    /** @scenario "A lease for another license or another instance is ignored" */
    it("stores no lease", async () => {
      const prisma = fakePrisma();
      const other = mintLicense({ maxMembers: 999 });

      await run({
        prisma,
        client: fakeClient({
          lease: leaseFor({ licenseId: other.licenseData.licenseId }),
        }).client,
      });

      expect(prisma.updates.at(-1)).not.toHaveProperty("connectLease");
    });
  });

  describe("when a stranger signed the lease", () => {
    /** @scenario "A lease that was tampered with is ignored" */
    it("stores no lease", async () => {
      const prisma = fakePrisma();

      await run({
        prisma,
        client: fakeClient({
          lease: leaseFor({ privateKey: STRANGER_KEYS.privateKey }),
        }).client,
      });

      expect(prisma.updates.at(-1)).not.toHaveProperty("connectLease");
    });
  });
});

describe("given a license LangWatch reissued", () => {
  describe("when the answer carries it", () => {
    it("stores it and syncs again with the new token", async () => {
      const prisma = fakePrisma();
      const reissued = mintLicense({ maxMembers: 80 });
      const renewedLease = leaseFor({
        licenseId: reissued.licenseData.licenseId,
      });
      const host = fakeClient(
        { lease: LEASE, license: reissued.licenseKey },
        { lease: renewedLease },
      );

      await run({ prisma, client: host.client });

      expect(prisma.storedLicense).toBe(reissued.licenseKey);
      expect(host.sent).toHaveLength(2);
      expect(prisma.updates.at(-1)?.connectLease).toEqual(renewedLease);
    });
  });

  describe("when the license in the answer does not verify", () => {
    /** @scenario "A delivered license that does not verify is not applied" */
    it("keeps the current license and records why", async () => {
      const prisma = fakePrisma();
      const forged = mintLicense({
        maxMembers: 5000,
        privateKey: STRANGER_KEYS.privateKey,
      });

      await run({
        prisma,
        client: fakeClient({ lease: LEASE, license: forged.licenseKey }).client,
      });

      expect(prisma.storedLicense).toBe(LICENSE.licenseKey);
      expect(prisma.updates.at(-1)?.connectLastSyncError).toBe(
        "license_key_invalid",
      );
    });
  });
});

describe("given a connect host that refuses", () => {
  describe("when it names the refusal", () => {
    /** @scenario "A failing sync is visible from the first failure" */
    it("records the code the host named and keeps the lease in place", async () => {
      const prisma = fakePrisma();
      const { ConnectUnreachableError } = await import(
        "@ee/licensing/connect/install/connectErrors"
      );

      await run({
        prisma,
        client: refusingClient(
          new ConnectUnreachableError({
            host: "connect.example.test",
            port: 443,
          }),
        ),
      });

      expect(prisma.updates.at(-1)?.connectLastSyncError).toBe(
        "connect_unreachable",
      );
      expect(prisma.updates.at(-1)).not.toHaveProperty("connectLease");
      expect(prisma.updates.at(-1)).not.toHaveProperty("connectLastSyncAt");
    });
  });

  describe("when the failure has no name of its own", () => {
    it("records it as the sync not completing", async () => {
      const prisma = fakePrisma();

      await run({
        prisma,
        client: refusingClient(new Error("socket hang up")),
      });

      expect(prisma.updates.at(-1)?.connectLastSyncError).toBe(
        "license_sync_failed",
      );
    });
  });
});

describe("given an install with nothing to sync", () => {
  describe("when the organization holds no license", () => {
    /** @scenario "An install without a license sends no sync" */
    it("sends nothing", async () => {
      const prisma = fakePrisma({ license: null });
      const host = fakeClient({ lease: LEASE });

      await run({ prisma, client: host.client });

      expect(host.sent).toHaveLength(0);
      expect(prisma.updates).toHaveLength(0);
    });
  });

  describe("when Connect is switched off for the deployment", () => {
    /** @scenario "An install with Connect disabled sends no sync" */
    it("sends nothing and starts no worker", async () => {
      connectEnabled.current = false;
      const prisma = fakePrisma();
      const host = fakeClient({ lease: LEASE });

      await syncLicensesForAllOrganizations({
        prisma: prisma.client,
        client: host.client,
        repository: fakeRepository(),
      });

      expect(host.sent).toHaveLength(0);
      expect(startLicenseSyncWorker()).toBeUndefined();
    });
  });
});

describe("given the version this install reports", () => {
  describe("when the deployment names one", () => {
    it("reports what the deployment named", () => {
      expect(readInstallVersion({ SERVICE_VERSION: "3.17.0" })).toBe("3.17.0");
      expect(
        readInstallVersion({
          OTEL_RESOURCE_ATTRIBUTES:
            "service.name=langwatch,service.version=4.0",
        }),
      ).toBe("4.0");
    });
  });

  describe("when the deployment names none", () => {
    it("reports unknown rather than a number made up here", () => {
      expect(readInstallVersion({})).toBe("unknown");
    });
  });
});
