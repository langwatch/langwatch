/**
 * The suppression list read a page at a time: stable order, truthful
 * continuation and a walk that survives the list changing underneath it.
 * @see modules/automation/specs/email-suppression-continuation.feature
 */
import type { EmailSuppression, EmailSuppressionCursor } from "@langwatch/automation-contract";
import { describe, expect, it } from "vitest";

import { EmailSuppressionNameRepository } from "../../repositories/email-suppression-name.repository.ts";
import { MemoryAutomationStore } from "../../repositories/memory/memory.automation.store.ts";
import { MemoryEmailSuppressionRepository } from "../../repositories/memory/memory.email-suppression.repository.ts";
import { AutomationEmailSuppressionService } from "../automation-email-suppression.service.ts";
import { UnsubscribeTokenVerifier } from "../unsubscribe-token.service.ts";

class Names extends EmailSuppressionNameRepository {
  readonly lookups: string[][] = [];
  findNames() {
    return Promise.resolve(null);
  }
  findTriggerNames(input: { triggerIds: string[] }) {
    this.lookups.push(input.triggerIds);
    return Promise.resolve(new Map(input.triggerIds.map((id) => [id, `Name of ${id}`])));
  }
}

class Verifier extends UnsubscribeTokenVerifier {
  findVerifiedPayload() {
    return null;
  }
}

const MINUTE = 60_000;
const BASE = Date.parse("2026-10-01T10:00:00.000Z");

function row(input: {
  id: string;
  at: number;
  projectId?: string;
  triggerId?: string | null;
}): EmailSuppression {
  return {
    id: input.id,
    projectId: input.projectId ?? "project-1",
    email: `${input.id}@example.com`,
    triggerId: input.triggerId ?? null,
    reason: "unsubscribe",
    createdAt: new Date(BASE + input.at * MINUTE),
  };
}

function serviceHolding(rows: EmailSuppression[]) {
  const memory = MemoryAutomationStore.create();
  memory.suppressions.push(...rows);
  const names = new Names();
  const suppressions = MemoryEmailSuppressionRepository.create(memory);
  const service = AutomationEmailSuppressionService.create({
    suppressions,
    names,
    verifier: new Verifier(),
  });

  return { memory, names, service, suppressions };
}

const FIVE = [1, 2, 3, 4, 5].map((n) => row({ id: `s${n}`, at: n }));
const ids = (page: { rows: { id: string }[] }) => page.rows.map((r) => r.id);

describe("the suppression list read a page at a time", () => {
  describe("given more suppressions than fit one page", () => {
    describe("when the pages are read one after the other from the first", () => {
      /** @scenario "Pages walk the whole list once, in order" */
      it("shows every suppression once, newest first, and only the last page ends", async () => {
        const { service } = serviceHolding(FIVE);

        const first = await service.getPageEnriched({ projectId: "project-1", limit: 2 });
        const second = await service.getPageEnriched({
          projectId: "project-1",
          limit: 2,
          cursor: first.nextCursor,
        });
        const last = await service.getPageEnriched({
          projectId: "project-1",
          limit: 2,
          cursor: second.nextCursor,
        });

        expect([ids(first), ids(second), ids(last)]).toEqual([["s5", "s4"], ["s3", "s2"], ["s1"]]);
        expect(first.nextCursor).toEqual({ createdAt: FIVE[3]?.createdAt, id: "s4" });
        expect(second.nextCursor).not.toBeNull();
        expect(last.nextCursor).toBeNull();
      });
    });
  });

  describe("given exactly as many suppressions as the page size", () => {
    describe("when the first page is read", () => {
      /** @scenario "A list that fills the last page exactly does not promise another" */
      it("holds them all and has no continuation", async () => {
        const { service } = serviceHolding(FIVE.slice(0, 4));

        const page = await service.getPageEnriched({ projectId: "project-1", limit: 4 });

        expect(ids(page)).toEqual(["s4", "s3", "s2", "s1"]);
        expect(page.nextCursor).toBeNull();
      });
    });
  });

  describe("given a project with no suppressions", () => {
    describe("when the first page is read", () => {
      /** @scenario "A project with no suppressions answers an empty last page" */
      it("is empty and has no continuation", async () => {
        const { service } = serviceHolding([row({ id: "elsewhere", at: 1, projectId: "other" })]);

        const page = await service.getPageEnriched({ projectId: "project-1", limit: 2 });

        expect(page).toEqual({ rows: [], nextCursor: null });
      });
    });
  });

  describe("given several suppressions created at the same instant", () => {
    describe("when the pages are read with a boundary inside that instant", () => {
      /** @scenario "Suppressions created in the same instant are neither repeated nor skipped" */
      it("shows each exactly once, ordered by id", async () => {
        const burst = ["a", "b", "c", "d", "e"].map((id) => row({ id, at: 7 }));
        const { service } = serviceHolding(burst);

        const seen: string[] = [];
        let cursor: EmailSuppressionCursor | null = null;
        do {
          const page = await service.getPageEnriched({ projectId: "project-1", limit: 2, cursor });
          seen.push(...ids(page));
          cursor = page.nextCursor;
        } while (cursor !== null);

        expect(seen).toEqual(["e", "d", "c", "b", "a"]);
      });
    });
  });

  describe("given the first page has been read", () => {
    describe("when a newer suppression is added and the next page is read", () => {
      /** @scenario "A suppression added after the first page does not repeat or displace rows" */
      it("continues after the first page and shows each remaining row once", async () => {
        const { memory, service } = serviceHolding(FIVE);
        const first = await service.getPageEnriched({ projectId: "project-1", limit: 2 });

        memory.suppressions.push(row({ id: "late", at: 9 }));
        const second = await service.getPageEnriched({
          projectId: "project-1",
          limit: 10,
          cursor: first.nextCursor,
        });

        expect(ids(second)).toEqual(["s3", "s2", "s1"]);
      });
    });

    describe("when the suppression its continuation points at is removed and the next page is read", () => {
      /** @scenario "A suppression removed between pages does not break the walk" */
      it("continues from the same position", async () => {
        const { service } = serviceHolding(FIVE);
        const first = await service.getPageEnriched({ projectId: "project-1", limit: 2 });

        await service.removeSuppression({ projectId: "project-1", id: "s4" });
        const second = await service.getPageEnriched({
          projectId: "project-1",
          limit: 2,
          cursor: first.nextCursor,
        });

        expect(ids(second)).toEqual(["s3", "s2"]);
      });
    });
  });

  describe("given a continuation that names a position, not a project", () => {
    describe("when it is used against a different project", () => {
      /** @scenario "A continuation taken from another project reveals nothing of it" */
      it("shows only that project's suppressions after the position", async () => {
        const { service } = serviceHolding([
          ...FIVE,
          row({ id: "o1", at: 0, projectId: "other" }),
          row({ id: "o3", at: 3, projectId: "other" }),
        ]);
        const foreign = await service.getPageEnriched({ projectId: "other", limit: 1 });

        const page = await service.getPageEnriched({
          projectId: "project-1",
          limit: 10,
          cursor: foreign.nextCursor,
        });

        expect(ids(foreign)).toEqual(["o3"]);
        expect(ids(page)).toEqual(["s2", "s1"]);
      });
    });
  });

  describe("given a page whose rows name some automations and some are project-wide", () => {
    describe("when the page is read", () => {
      /** @scenario "Each page names the automations it needs and no others" */
      it("looks up names for that page's rows only and leaves project-wide rows unnamed", async () => {
        const { names, service } = serviceHolding([
          row({ id: "s1", at: 1, triggerId: "t-old" }),
          row({ id: "s2", at: 2, triggerId: "t-new" }),
          row({ id: "s3", at: 3 }),
        ]);

        const page = await service.getPageEnriched({ projectId: "project-1", limit: 2 });

        expect(names.lookups).toEqual([["t-new"]]);
        expect(page.rows.map((r) => [r.id, r.triggerName])).toEqual([
          ["s3", null],
          ["s2", "Name of t-new"],
        ]);
      });
    });
  });

  describe("given a project with several suppressions", () => {
    describe("when the whole list is read", () => {
      /** @scenario "The whole-list read still answers every suppression with its automation name" */
      it("answers every suppression, as before", async () => {
        const { service } = serviceHolding([
          row({ id: "s1", at: 1, triggerId: "t-1" }),
          row({ id: "s2", at: 2 }),
          row({ id: "s3", at: 3, triggerId: "t-1" }),
        ]);

        const all = await service.getAllEnriched({ projectId: "project-1" });

        expect(all.map((r) => [r.id, r.triggerName])).toEqual([
          ["s1", "Name of t-1"],
          ["s2", null],
          ["s3", "Name of t-1"],
        ]);
      });
    });
  });
});
