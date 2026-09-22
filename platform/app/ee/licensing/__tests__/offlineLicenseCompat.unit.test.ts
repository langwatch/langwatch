/**
 * Existing offline licenses do not break (ADR-141, "Existing offline licenses").
 *
 * The fixture was minted with the licensing code of origin/main before this
 * change, with the arguments scripts/generate-license.ts passes. Everything
 * here must hold with no connect configuration, no registry and no network:
 * a self-hosted install that upgrades and sets nothing new behaves as before.
 */
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ILicenseEnforcementRepository } from "~/server/license-enforcement/license-enforcement.repository";
import { assertMemberTypeLimitNotExceeded } from "~/server/license-enforcement/license-limit-guard";
import { PLACEHOLDER_PUBLIC_KEY } from "../constants";
import { LicenseHandler } from "../licenseHandler";
import { mapToPlanInfo } from "../planMapping";
import { LicenseDataSchema } from "../types";
import { parseLicenseKey, validateLicense } from "../validation";

vi.mock("~/server/app-layer/app", () => ({
  tryGetApp: () => null,
  getApp: () => ({
    usageLimits: {
      notifyResourceLimitReached: vi.fn().mockResolvedValue(undefined),
    },
  }),
}));

vi.mock("~/utils/posthogErrorCapture", () => ({
  captureException: vi.fn(),
  toError: (error: unknown) =>
    error instanceof Error ? error : new Error(String(error)),
}));

interface OfflineFixture {
  mintedFromCommit: string;
  productionPublicKey: string;
  publicKey: string;
  licenseKey: string;
  expected: {
    licenseId: string;
    organizationName: string;
    plan: { maxMembers: number; maxMembersLite?: number; type: string };
    expiresAt: string;
  };
}

const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/offline-license-from-main.json", import.meta.url),
    "utf8",
  ),
) as OfflineFixture;

const ORG = "org_offline";
const NOW = new Date("2026-09-19T12:00:00.000Z");

/**
 * A database an offline install has: the organization row with its license.
 * Any other model, the registry included, throws on access, which is how this
 * test proves the offline path never looks at the registry.
 */
function offlinePrisma(licenseKey: string | null) {
  const organization = {
    findUnique: vi.fn(async () => ({
      id: ORG,
      name: "ACME Offline",
      license: licenseKey,
    })),
  };
  return new Proxy(
    {},
    {
      get(_target, property) {
        if (property === "organization") return organization;
        if (property === "then") return undefined;
        throw new Error(
          `offline license validation touched prisma.${String(property)}`,
        );
      },
    },
  ) as never;
}

function repositoryWith(memberCount: number): ILicenseEnforcementRepository {
  return {
    getMemberCount: vi.fn().mockResolvedValue(memberCount),
    getMembersLiteCount: vi.fn().mockResolvedValue(0),
    getCurrentMonthCost: vi.fn(),
    getCurrentMonthCostForProjects: vi.fn(),
  };
}

describe("a license minted by main before this change", () => {
  const fetchSpy = vi.fn(() => {
    throw new Error("offline license validation attempted a network call");
  });

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchSpy);
    fetchSpy.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("when it is validated on this branch", () => {
    it("verifies with the same key and yields the same signed data", () => {
      const verdict = validateLicense({
        licenseKey: fixture.licenseKey,
        publicKey: fixture.publicKey,
        now: NOW,
      });

      expect(verdict.valid).toBe(true);
      if (!verdict.valid) return;
      expect(verdict.licenseData).toEqual(fixture.expected);
    });

    it("re-serializes byte for byte, so the signature still covers the same schema", () => {
      const parsed = parseLicenseKey(fixture.licenseKey);

      expect(parsed).not.toBeNull();
      expect(JSON.stringify(parsed?.data)).toBe(
        JSON.stringify(fixture.expected),
      );
      expect(LicenseDataSchema.safeParse(fixture.expected).success).toBe(true);
    });

    it("maps to the same plan limits", () => {
      const verdict = validateLicense({
        licenseKey: fixture.licenseKey,
        publicKey: fixture.publicKey,
        now: NOW,
      });
      if (!verdict.valid) throw new Error("fixture must validate");

      expect(mapToPlanInfo(verdict.licenseData)).toMatchObject({
        maxMembers: fixture.expected.plan.maxMembers,
        maxMembersLite: fixture.expected.plan.maxMembersLite,
      });
    });

    it("is still verified against the production public key main shipped", () => {
      expect(PLACEHOLDER_PUBLIC_KEY.trim()).toBe(
        fixture.productionPublicKey.trim(),
      );
    });
  });

  describe("when an install with no connect configuration enforces it", () => {
    const handler = (memberCount: number) =>
      new LicenseHandler({
        prisma: offlinePrisma(fixture.licenseKey),
        publicKey: fixture.publicKey,
        repository: repositoryWith(memberCount),
      });

    it("resolves the same self-hosted plan", async () => {
      const plan = await handler(0).getSelfHostedPlan(ORG);

      expect(plan.maxMembers).toBe(fixture.expected.plan.maxMembers);
      expect(plan.maxMembersLite).toBe(fixture.expected.plan.maxMembersLite);
    });

    it("resolves the seat count signed into the license and no other table", async () => {
      const plan = await handler(0).getSelfHostedPlan(ORG);

      expect(plan.maxMembers).toBe(fixture.expected.plan.maxMembers);
    });

    it("reports the same license status", async () => {
      const status = await handler(3).getLicenseStatus(ORG);

      expect(status).toMatchObject({
        hasLicense: true,
        valid: true,
        organizationName: fixture.expected.organizationName,
        maxMembers: fixture.expected.plan.maxMembers,
        currentMembers: 3,
      });
    });

    it("keeps the hard seat cap: the seat past the licensed count is refused", async () => {
      const seats = fixture.expected.plan.maxMembers;
      const plan = await handler(seats).getSelfHostedPlan(ORG);

      await expect(
        assertMemberTypeLimitNotExceeded(
          "lite-to-full",
          ORG,
          repositoryWith(seats),
          { maxMembers: plan.maxMembers, maxMembersLite: plan.maxMembersLite },
        ),
      ).rejects.toMatchObject({ code: "resource_limit_exceeded" });
    });

    it("keeps admitting a seat within the licensed count", async () => {
      const seats = fixture.expected.plan.maxMembers;
      const plan = await handler(seats - 1).getSelfHostedPlan(ORG);

      await expect(
        assertMemberTypeLimitNotExceeded(
          "lite-to-full",
          ORG,
          repositoryWith(seats - 1),
          { maxMembers: plan.maxMembers, maxMembersLite: plan.maxMembersLite },
        ),
      ).resolves.toBeUndefined();
    });

    it("makes no network call and never reads the registry", async () => {
      const seats = fixture.expected.plan.maxMembers;
      const offline = handler(seats);

      await offline.getSelfHostedPlan(ORG);
      await offline.getActivePlan(ORG);
      await offline.getLicenseStatus(ORG);
      await assertMemberTypeLimitNotExceeded(
        "lite-to-full",
        ORG,
        repositoryWith(seats),
        { maxMembers: seats, maxMembersLite: 4 },
      ).catch(() => undefined);

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("keeps the registry out of every module that validates or enforces a license", () => {
      const modules = OFFLINE_LICENSE_DIRECTORIES.flatMap((directory) =>
        modulesUnder(new URL(directory, import.meta.url)),
      );
      const offenders = modules
        .filter((module) =>
          /from\s+"[^"]*\/registry(\/|")/.test(readFileSync(module, "utf8")),
        )
        .map((module) => module.pathname);

      expect(modules.length).toBeGreaterThan(20);
      expect(offenders).toEqual([]);
    });
  });
});

/**
 * The upgrade guarantee for Connect: an install that sets none of the new
 * variables keeps the behaviour it had and opens no connection.
 */
describe("an install upgraded with no Connect configuration", () => {
  const CONNECT_VARIABLES = [
    "LANGWATCH_CONNECT_DISABLED",
    "LANGWATCH_CONNECT_GATEWAY_ENDPOINT",
    "LANGWATCH_CONNECT_LICENSE_ENDPOINT",
    "LANGWATCH_CONNECT_INSTANCE_ID",
  ] as const;

  describe("when its environment is parsed", () => {
    it("parses with every Connect variable absent, none of them required", async () => {
      for (const name of CONNECT_VARIABLES) {
        expect(process.env[name]).toBeUndefined();
      }

      const { env } = await import("~/env.mjs");

      expect(env.LANGWATCH_CONNECT_DISABLED).toBe(false);
      expect(env.LANGWATCH_CONNECT_GATEWAY_ENDPOINT).toBeUndefined();
      expect(env.LANGWATCH_CONNECT_LICENSE_ENDPOINT).toBeUndefined();
      expect(env.LANGWATCH_CONNECT_INSTANCE_ID).toBeUndefined();
    });
  });

  describe("when the license minted by main is read for an entitlement", () => {
    /** @scenario "An install on an offline license keeps its telemetry destination" */
    it("names no hosted service, so no path builds a client", async () => {
      vi.resetModules();
      vi.doMock("~/env.mjs", () => ({ env: {} }));

      const { licenseConnectServices } = await import(
        "@ee/licensing/connect/install/connectEntitlement"
      );

      expect(
        licenseConnectServices({
          licenseKey: fixture.licenseKey,
          publicKey: fixture.publicKey,
          now: NOW,
        }),
      ).toEqual([]);

      vi.doUnmock("~/env.mjs");
    });
  });

  describe("when its daily jobs run", () => {
    /** @scenario "An install with Connect disabled sends no sync" */
    it("syncs nothing and posts its statistics where it always did", async () => {
      vi.resetModules();
      vi.doMock("~/env.mjs", () => ({ env: { NODE_ENV: "test" } }));
      vi.doMock("~/server/db", () => ({ prisma: {} }));

      const { syncLicensesForAllOrganizations } = await import(
        "~/server/licenseSyncWorker"
      );
      const { usageStatsEndpoint, USAGE_STATS_APP_HOST_URL } = await import(
        "~/server/usageStatsWorker"
      );

      // The offline install's own database: one organization, holding the
      // license main minted, which names no hosted service. A pass over it
      // reaches the client for no organization at all.
      const client = {
        syncLicense: vi.fn(async () => {
          throw new Error("an offline install synced its license");
        }),
      };
      await syncLicensesForAllOrganizations({
        prisma: {
          organization: {
            findMany: async () => [{ id: ORG, license: fixture.licenseKey }],
          },
        } as never,
        client: client as never,
      });
      expect(client.syncLicense).not.toHaveBeenCalled();

      // The destination does not move under an operator who changed nothing:
      // an install with no entitled license keeps posting to the app host it
      // has always posted to.
      await expect(
        usageStatsEndpoint({
          organization: { findMany: async () => [] },
        } as never),
      ).resolves.toBe(USAGE_STATS_APP_HOST_URL);
      expect(USAGE_STATS_APP_HOST_URL).toBe(
        "https://app.langwatch.ai/api/track_usage",
      );

      vi.doUnmock("~/server/db");
      vi.doUnmock("~/env.mjs");
      vi.resetModules();
    });
  });

  describe("when it judges an eval function", () => {
    /** @scenario "An install that sets nothing new keeps the classifier it had" */
    it("skips every judgement and calls nothing", async () => {
      const globalFetch = vi.fn(() => {
        throw new Error("an install with nothing configured called out");
      });
      vi.stubGlobal("fetch", globalFetch);
      const undiciFetch = vi.fn(() => {
        throw new Error("an install with nothing configured called out");
      });
      vi.resetModules();
      // Stated rather than inherited: the deployment here is one with no judge
      // key and no Connect configuration, whatever this machine's own .env has.
      vi.doMock("~/env.mjs", () => ({ env: { NODE_ENV: "test" } }));
      // The database of an offline install: one organization, holding the
      // license main minted, which names no hosted service.
      vi.doMock("~/server/db", () => ({
        prisma: {
          project: {
            findUnique: async () => ({ team: { organizationId: ORG } }),
          },
          organization: {
            findUnique: async () => ({
              license: fixture.licenseKey,
              connectServicesDisabled: [],
            }),
          },
        },
      }));
      vi.doMock("undici", async (importOriginal) => ({
        ...(await importOriginal<typeof import("undici")>()),
        fetch: undiciFetch,
      }));

      const { getInstantEvalClassifier, resetInstantEvalClassifier } =
        await import("~/server/app-layer/instant-evals/classifier");

      const classifier = getInstantEvalClassifier();
      const judgement = await classifier.classify({
        projectId: "project-of-an-offline-install",
        text: "the customer wrote in",
        questions: [
          { id: "annoyed", kind: "boolean", instructions: "sounds annoyed" },
        ],
      });
      await resetInstantEvalClassifier();

      expect(judgement.skippedReason).toBe("classifier_not_configured");
      expect(globalFetch).not.toHaveBeenCalled();
      expect(undiciFetch).not.toHaveBeenCalled();

      vi.doUnmock("undici");
      vi.doUnmock("~/server/db");
      vi.doUnmock("~/env.mjs");
      vi.resetModules();
      vi.unstubAllGlobals();
    });
  });
});

/**
 * What runs when an install validates its license and enforces its seats: the
 * licensing modules themselves and the enforcement layer. None of it may reach
 * the license registry, which lives in its own folder and exists only for
 * LangWatch Cloud.
 */
/**
 * Everything that runs inside an install: reading and verifying its license,
 * and enforcing the numbers that license sold. `connect/install` is on this
 * list because it too runs inside the install, on the license a sync left there.
 */
const OFFLINE_LICENSE_DIRECTORIES = [
  "../",
  "../connect/install/",
  "../../../src/server/license-enforcement/",
];

/**
 * The two subtrees that do not run inside an install and are therefore the
 * only ones allowed to read the registry: the registry itself, and the
 * LangWatch Cloud side of Connect.
 */
const CLOUD_ONLY_DIRECTORIES = new Set(["registry", "connect"]);

/**
 * Every `.ts` under a directory, nested ones included. A direct listing would
 * miss a validating or enforcing module one level down, and that module could
 * reach the registry with this contract still reading green.
 */
function modulesUnder(directory: URL): URL[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      if (CLOUD_ONLY_DIRECTORIES.has(entry.name)) return [];
      return modulesUnder(new URL(`${entry.name}/`, directory));
    }
    return entry.name.endsWith(".ts") ? [new URL(entry.name, directory)] : [];
  });
}
