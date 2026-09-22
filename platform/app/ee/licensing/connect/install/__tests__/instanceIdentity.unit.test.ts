/**
 * The identity this install presents, and what it is not.
 *
 * What it is not is the thing worth pinning: the old identity carried the
 * customer's organization name in cleartext on every report, and named one
 * organization rather than one install.
 *
 * @see ../instanceIdentity.ts
 * @see specs/self-hosting/connected-services/connect-settings.feature
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "~/generated/prisma/client";
import {
  installInstanceId,
  readInstanceReportState,
  recordInstanceReport,
  resetInstanceIdentity,
} from "../instanceIdentity";

const env = vi.hoisted(() => ({}) as Record<string, unknown>);

vi.mock("~/env.mjs", () => ({ env }));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface Store {
  row: {
    instanceId: string;
    lastReportAt: Date | null;
    lastReportError: string | null;
  } | null;
  /** A second writer that wins the primary key before this one inserts. */
  raceWinner?: string;
}

function prismaOver(store: Store) {
  const create = vi.fn(async ({ data }: { data: { instanceId: string } }) => {
    if (store.raceWinner) {
      store.row = {
        instanceId: store.raceWinner,
        lastReportAt: null,
        lastReportError: null,
      };
      throw new Error("duplicate key value violates unique constraint");
    }
    store.row = {
      instanceId: data.instanceId,
      lastReportAt: null,
      lastReportError: null,
    };
    return { instanceId: data.instanceId };
  });
  const updateMany = vi.fn(
    async ({ data }: { data: Record<string, unknown> }) => {
      if (store.row) Object.assign(store.row, data);
      return { count: store.row ? 1 : 0 };
    },
  );
  return {
    create,
    updateMany,
    client: {
      instanceIdentity: {
        findUnique: vi.fn(async () => store.row),
        create,
        updateMany,
      },
    } as unknown as PrismaClient,
  };
}

beforeEach(() => {
  for (const key of Object.keys(env)) delete env[key];
  resetInstanceIdentity();
});

describe("given an install that has never presented an identity", () => {
  describe("when something asks for it", () => {
    /** @scenario "The instance identity names the install, not an organization" */
    it("mints a UUID that carries nothing about the customer", async () => {
      const store: Store = { row: null };
      const { client } = prismaOver(store);

      const id = await installInstanceId(client);

      expect(id).toMatch(UUID);
      expect(store.row?.instanceId).toBe(id);
    });
  });
});

describe("given an install that already holds an identity", () => {
  describe("when something asks for it again", () => {
    it("answers with the one on the row, and mints nothing", async () => {
      const store: Store = {
        row: {
          instanceId: "the-one-on-the-row",
          lastReportAt: null,
          lastReportError: null,
        },
      };
      const { client, create } = prismaOver(store);

      await expect(installInstanceId(client)).resolves.toBe(
        "the-one-on-the-row",
      );
      expect(create).not.toHaveBeenCalled();
    });

    it("reads it once for the life of the process", async () => {
      const store: Store = {
        row: {
          instanceId: "the-one-on-the-row",
          lastReportAt: null,
          lastReportError: null,
        },
      };
      const { client } = prismaOver(store);

      await installInstanceId(client);
      await installInstanceId(client);

      expect(client.instanceIdentity.findUnique).toHaveBeenCalledTimes(1);
    });
  });
});

describe("given two processes starting at once", () => {
  describe("when both mint an identity", () => {
    /** @scenario "Two processes minting the identity at once end with one identity" */
    it("the loser takes the winner's, so the install has one identity", async () => {
      const store: Store = { row: null, raceWinner: "minted-by-the-other" };
      const { client } = prismaOver(store);

      await expect(installInstanceId(client)).resolves.toBe(
        "minted-by-the-other",
      );
    });
  });
});

describe("given an operator who named the identity", () => {
  describe("when something asks for it", () => {
    /** @scenario "An operator can name the identity this install presents" */
    it("takes the named one and touches the database for nothing", async () => {
      env.LANGWATCH_CONNECT_INSTANCE_ID = "instance-of-record";
      const store: Store = { row: null };
      const { client } = prismaOver(store);

      await expect(installInstanceId(client)).resolves.toBe(
        "instance-of-record",
      );
      expect(client.instanceIdentity.findUnique).not.toHaveBeenCalled();
    });
  });
});

describe("given a report LangWatch refused", () => {
  describe("when the sender records how it went", () => {
    /** @scenario "A refused usage report is recorded rather than logged and forgotten" */
    it("writes the refusal and leaves the last success where it was", async () => {
      const lastSuccess = new Date("2026-09-20T12:00:00.000Z");
      const store: Store = {
        row: {
          instanceId: "id",
          lastReportAt: lastSuccess,
          lastReportError: null,
        },
      };
      const { client } = prismaOver(store);

      await recordInstanceReport({
        prisma: client,
        error: "usage_report_refused_400",
        at: new Date("2026-09-21T12:00:00.000Z"),
      });

      await expect(readInstanceReportState(client)).resolves.toEqual({
        lastReportAt: lastSuccess,
        lastReportError: "usage_report_refused_400",
      });
    });
  });
});

describe("given a report LangWatch accepted", () => {
  describe("when the sender records how it went", () => {
    it("moves the last success on and clears the refusal", async () => {
      const store: Store = {
        row: {
          instanceId: "id",
          lastReportAt: new Date("2026-09-20T12:00:00.000Z"),
          lastReportError: "usage_report_refused_400",
        },
      };
      const { client } = prismaOver(store);
      const at = new Date("2026-09-21T12:00:00.000Z");

      await recordInstanceReport({ prisma: client, error: null, at });

      await expect(readInstanceReportState(client)).resolves.toEqual({
        lastReportAt: at,
        lastReportError: null,
      });
    });
  });
});
