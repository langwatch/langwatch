// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * Asking a provider who works here, and what gets written down afterwards.
 *
 * Prisma is a fake and `ssrfSafeFetch` is a mock, so what is under test is the
 * decision sequence: which sources may be asked, that a refusal writes nothing
 * while an empty list writes nothing for a reason the caller can tell apart,
 * and — the property this service exists to preserve — that every sighting
 * goes through the erasure suppression check before it reaches a row.
 *
 * Spec: specs/governance/governance-people-discovery.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "~/generated/prisma/client";
import { IngestionSourceNotFoundError } from "../activity-monitor/ingestionSource.service";
import { ERASURE_SECRET_ENV, erasureDigest } from "../logic/erasureDigest";
import { PersonListingService } from "../personListing.service";

vi.mock("~/utils/ssrfProtection", () => ({ ssrfSafeFetch: vi.fn() }));
const { ssrfSafeFetch } = await import("~/utils/ssrfProtection");
const fetchMock = vi.mocked(ssrfSafeFetch);

const organizationId = "org_people_sync";
const ingestionSourceId = "src_openai_1";
const now = new Date("2026-09-09T12:00:00.000Z");

/** A secret long enough for `readErasureSecret`, stated rather than guessed. */
const ERASURE_SECRET = "a".repeat(64);

const reply = (params: { ok: boolean; status: number; body?: unknown }) =>
  ({
    ok: params.ok,
    status: params.status,
    statusText: "",
    json: async () => params.body ?? {},
  }) as unknown as Awaited<ReturnType<typeof ssrfSafeFetch>>;

const openaiSource = {
  id: ingestionSourceId,
  sourceType: "openai_admin",
  parserConfig: {
    adapter: "openai_admin",
    report: "cost",
    schedule: "0 * * * *",
    // A legacy plaintext subtree rather than a sealed envelope, which
    // `decryptCredentials` accepts by design: this file asserts the seam's
    // plumbing, not the cipher.
    credentials: { token: "sk-admin" },
  },
};

/**
 * Records every `discoveredPerson` write, and serves whatever suppression rows
 * the case seeds.
 */
const fakePrisma = ({
  source,
  suppressed = [],
}: {
  source: unknown;
  /** Raw identifiers this organization has erased for this provider. */
  suppressed?: string[];
}) => {
  const sightings: Record<string, unknown>[] = [];
  const prisma = {
    ingestionSource: { findFirst: async () => source },
    erasedIdentifierSuppression: {
      findMany: async () =>
        suppressed.map((identifier) => ({
          organizationId,
          provider: "openai_admin",
          identifierHash: erasureDigest({
            secret: ERASURE_SECRET,
            identifier,
          }),
        })),
    },
    discoveredPerson: {
      createMany: async ({ data }: { data: Record<string, unknown>[] }) => {
        sightings.push(data[0]!);
        return { count: 1 };
      },
      updateMany: async () => ({ count: 0 }),
      findFirst: async () => null,
    },
  } as unknown as PrismaClient;
  return { prisma, sightings };
};

beforeEach(() => {
  fetchMock.mockReset();
  process.env[ERASURE_SECRET_ENV] = ERASURE_SECRET;
});

describe("PersonListingService.syncFromSource", () => {
  describe("given the provider names people", () => {
    it("records one person per member, with the source type as provider", async () => {
      fetchMock.mockResolvedValueOnce(
        reply({
          ok: true,
          status: 200,
          body: {
            data: [
              { id: "user-1", name: "Ada", email: "ada@example.com" },
              { id: "user-2", name: "Grace", email: "grace@example.com" },
            ],
          },
        }),
      );
      const { prisma, sightings } = fakePrisma({ source: openaiSource });

      const result = await PersonListingService.create(prisma).syncFromSource({
        organizationId,
        ingestionSourceId,
        now,
      });

      expect(result).toEqual({ outcome: "listed", recorded: 2 });
      expect(sightings).toHaveLength(2);
      expect(sightings[0]).toMatchObject({
        organizationId,
        provider: "openai_admin",
        rawActorId: "user-1",
        displayText: "Ada",
      });
    });

    /**
     * The directory path, not the activity path. Those dates mean "was
     * active", and refreshing a staff list must not make everyone in it look
     * like they used a model today.
     */
    it("stamps them from the listing day rather than the instant", async () => {
      fetchMock.mockResolvedValueOnce(
        reply({
          ok: true,
          status: 200,
          body: { data: [{ id: "user-1", name: "Ada" }] },
        }),
      );
      const { prisma, sightings } = fakePrisma({ source: openaiSource });

      await PersonListingService.create(prisma).syncFromSource({
        organizationId,
        ingestionSourceId,
        now,
      });

      expect(sightings[0]).toMatchObject({
        firstSeenAt: new Date("2026-09-09T00:00:00.000Z"),
        lastSeenAt: new Date("2026-09-09T00:00:00.000Z"),
      });
    });
  });

  describe("given somebody the provider still lists has been erased", () => {
    /**
     * The property this service exists to preserve. Providers keep listing a
     * person long after an erasure, so a listing that skipped the check would
     * re-create the plaintext row the day after every erasure — which is the
     * same re-import the scheduled pull's check exists to stop.
     */
    it("writes no row for them", async () => {
      fetchMock.mockResolvedValueOnce(
        reply({
          ok: true,
          status: 200,
          body: {
            data: [
              { id: "user-erased", name: "Erased" },
              { id: "user-2", name: "Grace" },
            ],
          },
        }),
      );
      const { prisma, sightings } = fakePrisma({
        source: openaiSource,
        suppressed: ["user-erased"],
      });

      const result = await PersonListingService.create(prisma).syncFromSource({
        organizationId,
        ingestionSourceId,
        now,
      });

      expect(sightings.map((row) => row.rawActorId)).toEqual(["user-2"]);
      expect(result).toEqual({ outcome: "listed", recorded: 1 });
    });

    /**
     * `listed` with a count of zero is not `empty`: the tenant has staff, and
     * this deployment is right not to hold their names. Reporting it as empty
     * would say something false about the tenant.
     */
    it("still reads as a listing when every listed person is erased", async () => {
      fetchMock.mockResolvedValueOnce(
        reply({
          ok: true,
          status: 200,
          body: { data: [{ id: "user-erased", name: "Erased" }] },
        }),
      );
      const { prisma, sightings } = fakePrisma({
        source: openaiSource,
        suppressed: ["user-erased"],
      });

      const result = await PersonListingService.create(prisma).syncFromSource({
        organizationId,
        ingestionSourceId,
        now,
      });

      expect(result).toEqual({ outcome: "listed", recorded: 0 });
      expect(sightings).toEqual([]);
    });
  });

  describe("given the provider refuses", () => {
    it("writes nothing and reports the reason and the status", async () => {
      fetchMock.mockResolvedValueOnce(reply({ ok: false, status: 403 }));
      const { prisma, sightings } = fakePrisma({ source: openaiSource });

      const result = await PersonListingService.create(prisma).syncFromSource({
        organizationId,
        ingestionSourceId,
        now,
      });

      // A refusal is not evidence anybody left.
      expect(result).toEqual({
        outcome: "refused",
        refusal: { reason: "unauthorized", status: 403 },
      });
      expect(sightings).toEqual([]);
    });
  });

  describe("given the provider names nobody", () => {
    it("writes nothing, and says so differently from a refusal", async () => {
      fetchMock.mockResolvedValueOnce(
        reply({ ok: true, status: 200, body: { data: [] } }),
      );
      const { prisma, sightings } = fakePrisma({ source: openaiSource });

      const result = await PersonListingService.create(prisma).syncFromSource({
        organizationId,
        ingestionSourceId,
        now,
      });

      expect(result).toEqual({ outcome: "empty" });
      expect(sightings).toEqual([]);
    });
  });

  describe("given the source holds no credential", () => {
    it("refuses as not_configured without calling the provider", async () => {
      const { prisma } = fakePrisma({
        source: {
          ...openaiSource,
          parserConfig: { ...openaiSource.parserConfig, credentials: {} },
        },
      });

      const result = await PersonListingService.create(prisma).syncFromSource({
        organizationId,
        ingestionSourceId,
        now,
      });

      expect(result).toEqual({
        outcome: "refused",
        refusal: { reason: "not_configured", status: null },
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("given a source type with no people list", () => {
    it("refuses rather than failing, so one source in a list can say no", async () => {
      const { prisma } = fakePrisma({
        source: {
          id: "src_s3",
          sourceType: "s3_polling",
          parserConfig: { credentials: { token: "unused" } },
        },
      });

      const result = await PersonListingService.create(prisma).syncFromSource({
        organizationId,
        ingestionSourceId: "src_s3",
        now,
      });

      expect(result).toEqual({
        outcome: "refused",
        refusal: { reason: "not_configured", status: null },
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("given the source belongs to another organization", () => {
    it("raises rather than decrypting its credentials", async () => {
      // The seam scopes the read by organization in the predicate, so another
      // tenant's envelope is never unsealed before the check fails.
      const { prisma } = fakePrisma({ source: null });

      await expect(
        PersonListingService.create(prisma).syncFromSource({
          organizationId,
          ingestionSourceId,
          now,
        }),
      ).rejects.toBeInstanceOf(IngestionSourceNotFoundError);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
