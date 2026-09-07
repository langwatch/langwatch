// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import {
  SCIM_REQUEST_LOG_RETENTION_MS,
  ScimRequestLogService,
} from "../scim-request-log.service";

/**
 * The evidence table's own rules (ADR-126).
 *
 * It is evidence rather than truth, which is what gives it a retention window
 * and what makes an absent row mean "we do not know" rather than "it did not
 * happen". And it is read by people on a settings page, so what it may carry
 * is bounded: a method, a resource, a status, a slug and our own sentence —
 * never a token, never a header, never a provider's raw message.
 */

const NOW = new Date("2026-08-26T10:00:00.000Z");

const serviceWith = (over: Record<string, unknown> = {}) => {
  // Built first and read back, so an override is the mock the assertions
  // watch. Closing over the defaults instead made a test assert on a function
  // the service never called.
  const scimRequestLog = {
    create: vi.fn().mockResolvedValue(undefined),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    findMany: vi.fn().mockResolvedValue([]),
    ...over,
  } as {
    create: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  const prisma = { scimRequestLog } as unknown as PrismaClient;
  return {
    service: ScimRequestLogService.create(prisma),
    create: scimRequestLog.create,
    deleteMany: scimRequestLog.deleteMany,
    findMany: scimRequestLog.findMany,
  };
};

const RECORD = {
  organizationId: "org_acme",
  connectionId: "ssoc_acme",
  method: "POST",
  resource: "Users",
  status: 400,
  reason: "invalid_resource" as const,
  detail: "The resource is not valid: externalId",
};

describe("given a request that has been answered", () => {
  describe("when it is recorded", () => {
    /** @scenario "A request the directory makes is recorded with what we answered" */
    it("carries when it arrived, what it asked for, and the status we answered", async () => {
      const { service, create } = serviceWith();

      await service.record(RECORD);

      expect(create).toHaveBeenCalledWith({ data: RECORD });
    });

    /** @scenario "The log never carries the credential that was presented" */
    it("carries no token, no hash of one, and no request header", async () => {
      const { service, create } = serviceWith();

      await service.record(RECORD);

      const [{ data }] = create.mock.calls[0] as [{ data: object }];
      // Exhaustive rather than a spot check: the rule is what the row MAY
      // carry, so a field added without thinking fails here.
      expect(Object.keys(data).sort()).toEqual([
        "connectionId",
        "detail",
        "method",
        "organizationId",
        "reason",
        "resource",
        "status",
      ]);
    });
  });

  describe("when the row cannot be written", () => {
    it("leaves the answered request alone rather than failing it", async () => {
      const { service } = serviceWith({
        create: vi.fn().mockRejectedValue(new Error("table is gone")),
      });

      // The request already happened. Recording the evidence must not turn a
      // provisioning call that worked into one that failed.
      await expect(service.record(RECORD)).resolves.toBeUndefined();
    });
  });
});

describe("given recorded requests either side of the retention window", () => {
  describe("when the sweep runs", () => {
    /** @scenario "Requests older than the window are dropped" */
    it("drops what has aged out and leaves the rest", async () => {
      const expired = [{ id: "req_1" }, { id: "req_2" }, { id: "req_3" }];
      const { service, deleteMany, findMany } = serviceWith({
        findMany: vi.fn().mockResolvedValueOnce(expired).mockResolvedValue([]),
        deleteMany: vi.fn().mockResolvedValue({ count: 3 }),
      });

      const dropped = await service.sweepExpired({ now: NOW });

      expect(dropped).toBe(3);
      // The window is what decides, and it is asked for on the SELECT.
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            occurredAt: {
              lt: new Date(NOW.getTime() - SCIM_REQUEST_LOG_RETENTION_MS),
            },
          },
        }),
      );
      // Deleted by id, in a bounded batch: this table takes a row per SCIM
      // request, so one unbounded statement after any worker outage holds the
      // locks and writes the whole delete's WAL at once.
      expect(deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ["req_1", "req_2", "req_3"] } },
      });
    });

    it("keeps going until a batch comes back short", async () => {
      const full = Array.from({ length: 5_000 }, (_, index) => ({
        id: `req_${index}`,
      }));
      const { service, deleteMany } = serviceWith({
        findMany: vi
          .fn()
          .mockResolvedValueOnce(full)
          .mockResolvedValueOnce([{ id: "req_last" }])
          .mockResolvedValue([]),
        deleteMany: vi
          .fn()
          .mockResolvedValueOnce({ count: 5_000 })
          .mockResolvedValue({ count: 1 }),
      });

      // A backlog larger than one batch has to clear completely, or the
      // retention promise is only kept for the first five thousand rows.
      expect(await service.sweepExpired({ now: NOW })).toBe(5_001);
      expect(deleteMany).toHaveBeenCalledTimes(2);
    });
  });
});

describe("given a reader asking what a connection has served", () => {
  /** @scenario "Another organization's requests are not there to read" */
  it("asks for the organization as well as the connection", async () => {
    const { service, findMany } = serviceWith();

    await service.findForConnection({
      organizationId: "org_acme",
      connectionId: "ssoc_acme",
      limit: 50,
    });

    // A connection id is not a tenant. Both are in the predicate so a
    // connection id from another organization answers nothing.
    expect(findMany).toHaveBeenCalledWith({
      where: { organizationId: "org_acme", connectionId: "ssoc_acme" },
      orderBy: { occurredAt: "desc" },
      take: 50,
    });
  });
});
