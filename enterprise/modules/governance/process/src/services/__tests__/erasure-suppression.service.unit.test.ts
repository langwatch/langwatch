// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { createTestLogger } from "@langwatch/test-harness";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it, vi } from "vitest";

import { MemoryGovernanceRepositories } from "../../repositories/memory/memory.governance.repositories.ts";
import { PrismaErasedIdentifierSuppressionRepository } from "../../repositories/prisma/prisma.erased-identifier-suppression.repository.ts";
import { erasureDigest } from "../../rules/erasure-digest.rules.ts";
import { partitionSuppressedEvents } from "../../rules/erasure-suppression.rules.ts";
import { ErasureSuppressionService } from "../erasure-suppression.service.ts";

const SECRET = "a".repeat(32);
const ERASED = "leaver@acme.test";
const ACTIVE = "stays@acme.test";

const erasedRow = (provider: string) => ({
  organizationId: "org_a",
  provider,
  identifierHash: erasureDigest({ secret: SECRET, identifier: ERASED }),
});

/** The service over the real Prisma repository, its one read scripted on the harness double. */
function serviceOver(input: {
  findMany: (args?: unknown) => Promise<unknown>;
  erasureSecret?: string | undefined;
}) {
  const { findMany } = input;
  const erasureSecret = "erasureSecret" in input ? input.erasureSecret : SECRET;
  const { logger, lines } = createTestLogger();
  const service = ErasureSuppressionService.create({
    suppressions: PrismaErasedIdentifierSuppressionRepository.create(
      prismaDouble({ erasedIdentifierSuppression: { findMany } }),
    ),
    tenantHistory: MemoryGovernanceRepositories.create().tenantHistory,
    erasureSecret,
    logger,
  });
  return { service, lines };
}

describe("given a pull about to write rows a provider reported", () => {
  describe("when one of the reported actors has been erased", () => {
    /** @scenario "The next pull does not bring an erased person back" */
    it("holds those rows back and counts them", async () => {
      const { service } = serviceOver({
        findMany: vi.fn().mockResolvedValue([erasedRow("anthropic_admin")]),
      });
      const suppression = await service.loadForProvider({
        organizationId: "org_a",
        provider: "anthropic_admin",
      });

      const { kept, suppressedCount } = partitionSuppressedEvents({
        events: [{ actor: ERASED }, { actor: ACTIVE }, { actor: ERASED }],
        actorOf: (event) => event.actor,
        suppression,
      });

      expect(kept).toEqual([{ actor: ACTIVE }]);
      expect(suppressedCount).toBe(2);
    });
  });

  describe("when the identifier was erased at a different provider", () => {
    /** @scenario "Erasing someone at one provider does not silence them at another" */
    it("stores the rows as usual", async () => {
      const { service } = serviceOver({
        findMany: vi.fn().mockResolvedValue([erasedRow("anthropic_admin")]),
      });
      const suppression = await service.loadForProvider({
        organizationId: "org_a",
        provider: "openai_admin",
      });

      const { kept, suppressedCount } = partitionSuppressedEvents({
        events: [{ actor: ERASED }],
        actorOf: (event) => event.actor,
        suppression,
      });

      expect(kept).toHaveLength(1);
      expect(suppressedCount).toBe(0);
    });
  });

  describe("when the erasure list cannot be read", () => {
    /** @scenario "A pull still runs when the erasure list cannot be read" */
    it("keeps every row rather than failing the run", async () => {
      const { service } = serviceOver({
        findMany: vi.fn().mockRejectedValue(new Error("connection refused")),
      });
      const suppression = await service.loadForProvider({
        organizationId: "org_a",
        provider: "anthropic_admin",
      });

      const { kept, suppressedCount } = partitionSuppressedEvents({
        events: [{ actor: ERASED }],
        actorOf: (event) => event.actor,
        suppression,
      });

      expect(suppression.isEmpty).toBe(true);
      expect(kept).toHaveLength(1);
      expect(suppressedCount).toBe(0);
    });
  });

  describe("when the organization has erasures and this process has no secret", () => {
    /** @scenario "A process with no secret says so instead of quietly ignoring the list" */
    it("says so loudly rather than passing for a deployment with nothing erased", async () => {
      const { service, lines } = serviceOver({
        findMany: vi.fn().mockResolvedValue([erasedRow("anthropic_admin")]),
        erasureSecret: undefined,
      });
      const suppression = await service.loadForProvider({
        organizationId: "org_a",
        provider: "anthropic_admin",
      });

      // Fails open like every unreadable-list case; what changed is that it is not silent.
      expect(suppression.isEmpty).toBe(true);
      expect(lines.filter((line) => line.level === 50)).toHaveLength(1);
      expect(lines.findLine("error", "no erasure secret")).toMatchObject({
        organizationId: "org_a",
        suppressedIdentifiers: 1,
      });
    });

    it("stays silent when the list is empty, which is the ordinary deployment", async () => {
      const { service, lines } = serviceOver({
        findMany: vi.fn().mockResolvedValue([]),
        erasureSecret: undefined,
      });
      const suppression = await service.loadForProvider({
        organizationId: "org_a",
        provider: "anthropic_admin",
      });

      expect(suppression.isEmpty).toBe(true);
      expect(lines.filter((line) => line.level === 50)).toHaveLength(0);
    });
  });

  describe("when nobody in the organization has been erased", () => {
    it("does not read the list twice per row, and keeps everything", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const { service } = serviceOver({ findMany });
      const suppression = await service.loadForProvider({
        organizationId: "org_a",
        provider: "anthropic_admin",
      });

      const { kept, suppressedCount } = partitionSuppressedEvents({
        events: [{ actor: ERASED }, { actor: ACTIVE }],
        actorOf: (event) => event.actor,
        suppression,
      });

      expect(kept).toHaveLength(2);
      expect(suppressedCount).toBe(0);
      expect(findMany).toHaveBeenCalledTimes(1);
    });
  });

  describe("when an event carries no actor at all", () => {
    it("does not treat the empty string as a match", async () => {
      const { service } = serviceOver({
        findMany: vi.fn().mockResolvedValue([erasedRow("anthropic_admin")]),
      });
      const suppression = await service.loadForProvider({
        organizationId: "org_a",
        provider: "anthropic_admin",
      });

      expect(suppression.isSuppressed("")).toBe(false);
    });
  });
});

describe("given a deployment that has never configured an erasure secret", () => {
  describe("when a pull asks for the suppression list", () => {
    it("still reads the list, because an absent secret does not prove an empty one", async () => {
      const findMany = vi.fn().mockResolvedValue([erasedRow("anthropic_admin")]);
      const { service, lines } = serviceOver({ findMany, erasureSecret: "" });
      const suppression = await service.loadForProvider({
        organizationId: "org_a",
        provider: "anthropic_admin",
      });

      expect(findMany).toHaveBeenCalledTimes(1);
      expect(suppression.isEmpty).toBe(true);
      expect(lines.filter((line) => line.level === 50)).toHaveLength(1);
    });
  });
});
