// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * The adapter between the pipeline's `listPeople` intent and the service.
 *
 * The service is mocked: what is under test is the wiring the pipeline depends
 * on — where the organization comes from, what instant the sync is stamped
 * with, and that a source that has gone away produces a refusal rather than an
 * error the outbox would retry three times to reach the same place.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "~/generated/prisma/client";

vi.mock("../../personListing.service", () => ({
  PersonListingService: { create: vi.fn() },
}));

const { PersonListingService } = await import("../../personListing.service");
const { createPeopleListingPort } = await import("../peopleListingPort");

const syncFromSource = vi.fn();

const prismaWith = (source: unknown) =>
  ({
    ingestionSource: { findUnique: async () => source },
  }) as unknown as PrismaClient;

beforeEach(() => {
  syncFromSource.mockReset();
  vi.mocked(PersonListingService.create).mockReturnValue({
    syncFromSource,
  } as unknown as ReturnType<typeof PersonListingService.create>);
});

describe("createPeopleListingPort", () => {
  it("resolves the organization from the source, not from the intent", async () => {
    syncFromSource.mockResolvedValue({ outcome: "empty" });
    const port = createPeopleListingPort({
      prisma: prismaWith({ organizationId: "org-1" }),
      clock: () => new Date("2026-09-09T12:00:00.000Z"),
    });

    await port.list({ sourceId: "src-1" });

    // Tenancy stays out of the process state, where it would have to be kept
    // in step with a source that can be moved or deleted.
    expect(syncFromSource).toHaveBeenCalledWith({
      organizationId: "org-1",
      ingestionSourceId: "src-1",
      now: new Date("2026-09-09T12:00:00.000Z"),
    });
  });

  it("reports what the provider named and what was withheld", async () => {
    syncFromSource.mockResolvedValue({
      outcome: "listed",
      recorded: 42,
      named: 42,
      withheld: 0,
    });
    const port = createPeopleListingPort({
      prisma: prismaWith({ organizationId: "org-1" }),
    });

    await expect(port.list({ sourceId: "src-1" })).resolves.toEqual({
      outcome: "listed",
      directoryPersonCount: 42,
      withheldPersonCount: 0,
    });
  });

  /**
   * The lossy case, pinned at the seam that used to lose it: the provider named
   * five hundred and this deployment stored one. The port must pass on the five
   * hundred, because `recorded` is the number that cannot be recovered from and
   * the one a screen would otherwise report as the provider's answer.
   */
  it("passes on the provider's count when suppression withheld most of it", async () => {
    syncFromSource.mockResolvedValue({
      outcome: "listed",
      recorded: 1,
      named: 500,
      withheld: 499,
    });
    const port = createPeopleListingPort({
      prisma: prismaWith({ organizationId: "org-1" }),
    });

    await expect(port.list({ sourceId: "src-1" })).resolves.toEqual({
      outcome: "listed",
      directoryPersonCount: 500,
      withheldPersonCount: 499,
    });
  });

  it("flattens an empty tenant to a listing of zero", async () => {
    syncFromSource.mockResolvedValue({ outcome: "empty" });
    const port = createPeopleListingPort({
      prisma: prismaWith({ organizationId: "org-1" }),
    });

    // A refusal takes the other arm, so zeroes here can only mean the provider
    // answered and named nobody, with none withheld.
    await expect(port.list({ sourceId: "src-1" })).resolves.toEqual({
      outcome: "listed",
      directoryPersonCount: 0,
      withheldPersonCount: 0,
    });
  });

  it("passes a refusal through with its reason and status", async () => {
    syncFromSource.mockResolvedValue({
      outcome: "refused",
      refusal: { reason: "rate_limited", status: 429 },
    });
    const port = createPeopleListingPort({
      prisma: prismaWith({ organizationId: "org-1" }),
    });

    await expect(port.list({ sourceId: "src-1" })).resolves.toEqual({
      outcome: "refused",
      reason: "rate_limited",
      status: 429,
    });
  });

  it("refuses a source that no longer exists without asking the service", async () => {
    const port = createPeopleListingPort({ prisma: prismaWith(null) });

    // Retrying will not bring it back, so throwing would burn three attempts
    // to reach the same place.
    await expect(port.list({ sourceId: "gone" })).resolves.toEqual({
      outcome: "refused",
      reason: "not_found",
      status: null,
    });
    expect(syncFromSource).not.toHaveBeenCalled();
  });
});
