// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { beforeEach, describe, expect, it, vi } from "vitest";

/** One shared error spy, so a test can read what the service actually said. */
const loggedErrors = vi.hoisted(() => vi.fn());
vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: loggedErrors,
  }),
}));

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
    loggedErrors.mockClear();
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

  describe("when the organization has erasures and this process has no secret", () => {
    /** @scenario "A process with no secret says so instead of quietly ignoring the list" */
    it("says so loudly rather than passing for a deployment with nothing erased", async () => {
      vi.stubEnv(ERASURE_SECRET_ENV, undefined);

      const suppression = await loadErasureSuppression({
        prisma: prismaWith([erasedRow("anthropic_admin")]),
        organizationId: "org_a",
        provider: "anthropic_admin",
      });

      // Fails open, like every other unreadable-list case on this path: a pull
      // that refused would turn a misconfiguration into missing cost data. What
      // changed is that it is no longer silent about it.
      expect(suppression.isEmpty).toBe(true);
      expect(loggedErrors).toHaveBeenCalledTimes(1);
      expect(loggedErrors.mock.calls[0]?.[1]).toContain("no erasure secret");
      expect(loggedErrors.mock.calls[0]?.[0]).toMatchObject({
        organizationId: "org_a",
        suppressedIdentifiers: 1,
      });
    });

    it("stays silent when the list is empty, which is the ordinary deployment", async () => {
      vi.stubEnv(ERASURE_SECRET_ENV, undefined);

      const suppression = await loadErasureSuppression({
        prisma: prismaWith([]),
        organizationId: "org_a",
        provider: "anthropic_admin",
      });

      expect(suppression.isEmpty).toBe(true);
      expect(loggedErrors).not.toHaveBeenCalled();
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
    it("still reads the list, because an absent secret does not prove an empty one", async () => {
      vi.stubEnv(ERASURE_SECRET_ENV, "");
      loggedErrors.mockClear();
      const prisma = prismaWith([erasedRow("anthropic_admin")]);

      const suppression = await loadErasureSuppression({
        prisma,
        organizationId: "org_a",
        provider: "anthropic_admin",
      });

      // The read is what separates "nobody has been erased here" from "this
      // process cannot evaluate the erasures somebody asked for". Skipping it
      // to save a query made both look like the first one.
      expect(prisma.erasedIdentifierSuppression.findMany).toHaveBeenCalledTimes(
        1,
      );
      expect(suppression.isEmpty).toBe(true);
      expect(loggedErrors).toHaveBeenCalledTimes(1);
    });
  });
});
