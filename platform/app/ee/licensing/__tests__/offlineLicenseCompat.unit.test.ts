/**
 * Existing offline licenses do not break (ADR-139, "Existing offline licenses").
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
      const modules = OFFLINE_LICENSE_DIRECTORIES.flatMap((directory) => {
        const url = new URL(directory, import.meta.url);
        return readdirSync(url)
          .filter((name) => name.endsWith(".ts"))
          .map((name) => new URL(name, url));
      });
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
 * What runs when an install validates its license and enforces its seats: the
 * licensing modules themselves and the enforcement layer. None of it may reach
 * the license registry, which lives in its own folder and exists only for
 * LangWatch Cloud.
 */
const OFFLINE_LICENSE_DIRECTORIES = [
  "../",
  "../../../src/server/license-enforcement/",
];
