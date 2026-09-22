/**
 * The license sync of a connected install, daily and on demand.
 *
 * Driven through a fake connect host: what the install sends, what it keeps
 * of the answer, what an admin pressing refresh is told, and what it does
 * when the answer, the license in it, or the host itself cannot be trusted.
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
  mintLicense,
  NOW,
  ORGANIZATION_ID,
  STRANGER_KEYS,
} from "@ee/licensing/connect/install/__tests__/installFakes";
import { ConnectUnreachableError } from "@ee/licensing/connect/install/connectErrors";
import { handledErrorFromHerr } from "@langwatch/handled-error";
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
  startLicenseSyncWorker,
  syncLicenseNow,
  syncLicensesForAllOrganizations,
} from "../licenseSyncWorker";

const SERVICES = ["instant_evals"];

interface Updated {
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
      // The credential carries the install's own identity rather than an
      // organization id, so a sync reaches for this table.
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
function fakeClient(...answers: { services: string[]; license?: string }[]) {
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

const common = {
  publicKey: LANGWATCH_KEYS.publicKey,
  version: "3.17.0",
  now: () => NOW,
};

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
    ...common,
  });
}

function refresh({
  prisma,
  client,
}: {
  prisma: ReturnType<typeof fakePrisma>;
  client: ReturnType<typeof fakeClient>["client"];
}) {
  return syncLicenseNow({
    organizationId: ORGANIZATION_ID,
    prisma: prisma.client,
    client,
    repository: fakeRepository(),
    ...common,
  });
}

beforeEach(() => {
  connectEnabled.current = true;
  entitled.current = true;
});

describe("given a connected install with a registered license", () => {
  describe("when the daily sync runs", () => {
    /** @scenario "The sync sends the fixed license payload and nothing else" */
    it("sends the token, the instance id, the version and the seats in use", async () => {
      const prisma = fakePrisma();
      const host = fakeClient({ services: SERVICES });

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

    /** @scenario "The instance id on sync is the one the gateway sees" */
    it("presents the minted instance identity, carrying no organization name or id", async () => {
      const prisma = fakePrisma();
      const host = fakeClient({ services: SERVICES });

      await run({ prisma, client: host.client });

      const sent = host.sent[0] as { credential: { instanceId: string } };
      expect(sent.credential.instanceId).toBe(INSTANCE_ID);
      expect(sent.credential.instanceId).toBe(
        credentialOf(LICENSE.licenseKey).instanceId,
      );
      expect(sent.credential.instanceId).not.toContain("ACME");
      expect(sent.credential.instanceId).not.toContain(ORGANIZATION_ID);
    });

    /** @scenario "A sync records the reported seats and answers with the entitled services" */
    it("records when it succeeded and clears any earlier failure", async () => {
      const prisma = fakePrisma();

      await run({ prisma, client: fakeClient({ services: SERVICES }).client });

      const written = prisma.updates.at(-1);
      expect(written?.connectLastSyncAt).toEqual(NOW);
      expect(written?.connectLastSyncError).toBeNull();
    });
  });
});

describe("given a license LangWatch reissued", () => {
  describe("when the daily sync carries it", () => {
    /** @scenario "A reissued license arrives over sync and is applied" */
    it("stores it and syncs again with the new token", async () => {
      const prisma = fakePrisma();
      const reissued = mintLicense({ maxMembers: 80 });
      const host = fakeClient(
        { services: SERVICES, license: reissued.licenseKey },
        { services: SERVICES },
      );

      await run({ prisma, client: host.client });

      expect(prisma.storedLicense).toBe(reissued.licenseKey);
      expect(host.sent).toHaveLength(2);
      expect(prisma.updates.at(-1)?.connectLastSyncAt).toEqual(NOW);
    });
  });

  describe("when an admin presses refresh", () => {
    /** @scenario "An admin refreshes the license and gets the new seat count" */
    it("applies it now and answers with the new seat count", async () => {
      const prisma = fakePrisma();
      const reissued = mintLicense({ maxMembers: 80 });
      const host = fakeClient(
        { services: SERVICES, license: reissued.licenseKey },
        { services: SERVICES },
      );

      const result = await refresh({ prisma, client: host.client });

      expect(result).toEqual({
        outcome: "updated",
        maxMembers: 80,
        expiresAt: reissued.licenseData.expiresAt,
      });
      expect(prisma.storedLicense).toBe(reissued.licenseKey);
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
        client: fakeClient({ services: SERVICES, license: forged.licenseKey })
          .client,
      });

      expect(prisma.storedLicense).toBe(LICENSE.licenseKey);
      expect(prisma.updates.at(-1)?.connectLastSyncError).toBe(
        "license_key_invalid",
      );
    });

    it("tells an admin who pressed refresh that the license was refused", async () => {
      const prisma = fakePrisma();
      const forged = mintLicense({
        maxMembers: 5000,
        privateKey: STRANGER_KEYS.privateKey,
      });

      await expect(
        refresh({
          prisma,
          client: fakeClient({ services: SERVICES, license: forged.licenseKey })
            .client,
        }),
      ).rejects.toMatchObject({ code: "license_key_invalid" });
      expect(prisma.storedLicense).toBe(LICENSE.licenseKey);
    });
  });
});

describe("given nothing new on the registry", () => {
  describe("when an admin presses refresh", () => {
    /** @scenario "An admin refreshes a license that is already current" */
    it("says the license is unchanged and records the sync", async () => {
      const prisma = fakePrisma();

      const result = await refresh({
        prisma,
        client: fakeClient({ services: SERVICES }).client,
      });

      expect(result).toEqual({ outcome: "unchanged" });
      expect(prisma.updates.at(-1)?.connectLastSyncAt).toEqual(NOW);
    });
  });
});

describe("given a connect host that refuses", () => {
  describe("when it names the refusal", () => {
    /** @scenario "A failing sync is visible from the first failure" */
    it("records the code the host named and keeps the license in place", async () => {
      const prisma = fakePrisma();

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
      expect(prisma.updates.at(-1)).not.toHaveProperty("connectLastSyncAt");
      expect(prisma.storedLicense).toBe(LICENSE.licenseKey);
    });

    /** @scenario "A refresh that the registry rate limits is refused with its code" */
    it("hands an admin who pressed refresh the code, after recording it", async () => {
      const prisma = fakePrisma();
      // The transport turns the registry's envelope into this same error.
      const rateLimited = handledErrorFromHerr(
        {
          type: "rate_limited",
          code: "rate_limited",
          message: "this license has synced too many times today",
          fault: "customer",
        },
        { httpStatus: 429 },
      );

      await expect(
        refresh({ prisma, client: refusingClient(rateLimited) }),
      ).rejects.toMatchObject({ code: "rate_limited" });
      expect(prisma.updates.at(-1)?.connectLastSyncError).toBe("rate_limited");
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
      const host = fakeClient({ services: SERVICES });

      await run({ prisma, client: host.client });

      expect(host.sent).toHaveLength(0);
      expect(prisma.updates).toHaveLength(0);
    });

    /** @scenario "Refresh is offered on a connected license only" */
    it("refuses a refresh, because there is no connected license to refresh", async () => {
      const prisma = fakePrisma({ license: null });
      const host = fakeClient({ services: SERVICES });

      await expect(
        refresh({ prisma, client: host.client }),
      ).rejects.toMatchObject({ code: "connect_license_required" });
      expect(host.sent).toHaveLength(0);
    });
  });

  describe("when Connect is switched off for the deployment", () => {
    /** @scenario "An install with Connect disabled sends no sync" */
    it("sends nothing, starts no worker and refuses a refresh", async () => {
      connectEnabled.current = false;
      const prisma = fakePrisma();
      const host = fakeClient({ services: SERVICES });

      await syncLicensesForAllOrganizations({
        prisma: prisma.client,
        client: host.client,
        repository: fakeRepository(),
      });

      expect(host.sent).toHaveLength(0);
      expect(startLicenseSyncWorker()).toBeUndefined();
      await expect(
        refresh({ prisma, client: host.client }),
      ).rejects.toMatchObject({ code: "connect_disabled" });
    });
  });
});
