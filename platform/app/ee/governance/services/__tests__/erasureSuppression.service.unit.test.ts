// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "~/generated/prisma/client";
import {
  loadErasureSuppression,
  partitionSuppressedEvents,
} from "../erasureSuppression.service";
import { ERASURE_SECRET_ENV, erasureDigest } from "../logic/erasureDigest";

const SECRET = "a".repeat(32);
const ERASED = "leaver@acme.test";
const ACTIVE = "stays@acme.test";

/** A Prisma stand-in whose only job is to answer the suppression read. */
function prismaWith(
  rows: { organizationId: string; provider: string; identifierHash: string }[],
): PrismaClient {
  return {
    erasedIdentifierSuppression: {
      findMany: vi.fn().mockResolvedValue(rows),
    },
  } as unknown as PrismaClient;
}

function prismaThatFails(): PrismaClient {
  return {
    erasedIdentifierSuppression: {
      findMany: vi.fn().mockRejectedValue(new Error("connection refused")),
    },
  } as unknown as PrismaClient;
}

const erasedRow = (provider: string) => ({
  organizationId: "org_a",
  provider,
  identifierHash: erasureDigest({ secret: SECRET, identifier: ERASED }),
});

describe("given a pull about to write rows a provider reported", () => {
  beforeEach(() => {
    vi.stubEnv(ERASURE_SECRET_ENV, SECRET);
  });

  describe("when one of the reported actors has been erased", () => {
    /** @scenario "The next pull does not bring an erased person back" */
    it("holds those rows back and counts them", async () => {
      const suppression = await loadErasureSuppression({
        prisma: prismaWith([erasedRow("anthropic_admin")]),
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
      const suppression = await loadErasureSuppression({
        prisma: prismaWith([erasedRow("anthropic_admin")]),
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
      const suppression = await loadErasureSuppression({
        prisma: prismaThatFails(),
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

  describe("when nobody in the organization has been erased", () => {
    it("does not read the list twice per row, and keeps everything", async () => {
      const prisma = prismaWith([]);
      const suppression = await loadErasureSuppression({
        prisma,
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
      expect(prisma.erasedIdentifierSuppression.findMany).toHaveBeenCalledTimes(
        1,
      );
    });
  });

  describe("when an event carries no actor at all", () => {
    it("does not treat the empty string as a match", async () => {
      const suppression = await loadErasureSuppression({
        prisma: prismaWith([erasedRow("anthropic_admin")]),
        organizationId: "org_a",
        provider: "anthropic_admin",
      });

      expect(suppression.isSuppressed("")).toBe(false);
    });
  });
});

describe("given a deployment that has never configured an erasure secret", () => {
  describe("when a pull asks for the suppression list", () => {
    it("suppresses nothing, because nothing can have been erased", async () => {
      vi.stubEnv(ERASURE_SECRET_ENV, "");
      const prisma = prismaWith([erasedRow("anthropic_admin")]);

      const suppression = await loadErasureSuppression({
        prisma,
        organizationId: "org_a",
        provider: "anthropic_admin",
      });

      expect(suppression.isEmpty).toBe(true);
      expect(
        prisma.erasedIdentifierSuppression.findMany,
      ).not.toHaveBeenCalled();
    });
  });
});
