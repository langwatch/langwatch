/**
 * What an audit entry is allowed to carry. `args` can be megabytes, and an
 * audit row writes on every privileged action, so unbounded is a large
 * write on the busiest path there is. Narrows in steps, not a byte cutoff.
 */

import { describe, expect, it, vi } from "vitest";
import type { AuditLogRepository } from "../../repositories/audit-log.repository.ts";
import { DefaultAuditLogService } from "../audit-log.service.ts";

const command = (args?: unknown) => ({
  organizationId: "organization-1",
  userId: "user-1",
  action: "project.delete",
  ...(args === undefined ? {} : { args }),
});

function serviceWith(maxArgsBytes?: number) {
  const create = vi.fn(async (_row: { args?: unknown }) => undefined);
  const service = DefaultAuditLogService.create({
    repository: { create } as unknown as AuditLogRepository,
    ...(maxArgsBytes === undefined ? {} : { maxArgsBytes }),
  });

  return { create, service };
}

/** The `args` the repository was actually asked to store. */
const storedArgs = async (args: unknown, maxArgsBytes?: number) => {
  const { create, service } = serviceWith(maxArgsBytes);
  await service.record(command(args) as never);

  return create.mock.calls[0]?.[0]?.args;
};

describe("DefaultAuditLogService.record", () => {
  describe("given args that fit", () => {
    /** @scenario "A valid audit command is persisted" */
    it("stores them exactly as they were", async () => {
      const args = { projectId: "project-1", reason: "cleanup" };

      await expect(storedArgs(args)).resolves.toEqual(args);
    });

    it("stores nothing when the call carried no args", async () => {
      await expect(storedArgs(undefined)).resolves.toBeUndefined();
    });
  });

  describe("given args over the cap", () => {
    it("stores a smaller version of them", async () => {
      const stored = await storedArgs({ note: "x".repeat(5000) }, 1024);

      expect(JSON.stringify(stored).length).toBeLessThanOrEqual(1024);
    });

    it("keeps the shape, so the entry still says what the call was about", async () => {
      // A prefix of the JSON would be unreadable. The keys survive; only the
      // strings under them get shorter.
      const stored = (await storedArgs(
        { projectId: "project-1", note: "x".repeat(5000) },
        1024,
      )) as Record<string, string>;

      expect(Object.keys(stored)).toEqual(["projectId", "note"]);
      expect(stored.projectId).toBe("project-1");
      expect(stored.note?.endsWith("...")).toBe(true);
    });

    it("shortens strings nested in arrays and objects too", async () => {
      const stored = (await storedArgs({ items: [{ note: "y".repeat(5000) }] }, 1024)) as {
        items: { note: string }[];
      };

      expect(stored.items[0]?.note.endsWith("...")).toBe(true);
      expect(JSON.stringify(stored).length).toBeLessThanOrEqual(1024);
    });

    it("gives up and says so when no step is small enough", async () => {
      // A thousand keys cannot be shortened by shortening strings, so the
      // entry records that it dropped them rather than storing the lot.
      const wide = Object.fromEntries(
        Array.from({ length: 1000 }, (_, index) => [`key-${index}`, index]),
      );

      await expect(storedArgs(wide, 128)).resolves.toEqual({ "...": "[truncated]" });
    });
  });

  describe("the default cap", () => {
    it("bounds args nobody sized, at four kilobytes", async () => {
      const stored = await storedArgs({ note: "z".repeat(50_000) });

      expect(JSON.stringify(stored).length).toBeLessThanOrEqual(4 * 1024);
    });
  });
});
