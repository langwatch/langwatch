/**
 * What the address says the audit table is showing.
 *
 * Every filter this page applies is in the URL, because a compliance reviewer's
 * workflow is sending somebody else the exact view they are looking at. These
 * are the readings and the writes that make that true, asserted without a
 * router — which is the whole reason they are pure functions.
 *
 * Spec: specs/audit-log/audit-log.feature
 */

import { describe, expect, it } from "vitest";
import {
  auditBackLink,
  matchMemberId,
  readAuditPaging,
  readAuditTarget,
  withAuditFilter,
  withAuditPageOffset,
  withAuditPageSize,
  withoutAuditTarget,
} from "../audit-log-filters";

describe("given an address with no paging in it", () => {
  describe("when the table reads its page", () => {
    /** @scenario The audit table pages by offsets carried in the address */
    it("starts at the first page of twenty-five", () => {
      expect(readAuditPaging({})).toEqual({ pageOffset: 0, pageSize: 25 });
    });
  });
});

describe("given an address carrying paging", () => {
  describe("when the values are readable", () => {
    /** @scenario The audit table pages by offsets carried in the address */
    it("obeys them", () => {
      expect(readAuditPaging({ pageOffset: "50", pageSize: "100" })).toEqual({
        pageOffset: 50,
        pageSize: 100,
      });
    });
  });

  describe("when the values were hand-edited into nonsense", () => {
    /**
     * `skip: -25` is a database error rather than a page, so a hand-edited URL
     * lands on the first page instead of on a failure.
     */
    /** @scenario The audit table pages by offsets carried in the address */
    it("falls back rather than sending a negative or unreadable offset", () => {
      expect(readAuditPaging({ pageOffset: "-25", pageSize: "abc" })).toEqual({
        pageOffset: 0,
        pageSize: 25,
      });
    });
  });
});

describe("given a gateway deep-link", () => {
  describe("when both halves of the target are present", () => {
    /** @scenario Deep-link from VK detail page lands pre-filtered */
    it("reads the target the linking page wrote", () => {
      expect(readAuditTarget({ targetKind: "virtual_key", targetId: "vk_1" })).toEqual({
        targetKind: "virtual_key",
        targetId: "vk_1",
      });
    });
  });

  describe("when only one half arrived", () => {
    /** @scenario Deep-link from VK detail page lands pre-filtered */
    it("applies no target filter at all", () => {
      expect(readAuditTarget({ targetKind: "virtual_key" })).toBeUndefined();
      expect(readAuditTarget({ targetId: "vk_1" })).toBeUndefined();
    });
  });

  describe("when the reader clears the chip", () => {
    /** @scenario Deep-link from VK detail page lands pre-filtered */
    it("drops both halves and keeps every other filter", () => {
      expect(
        withoutAuditTarget({ targetKind: "budget", targetId: "b_1", actionFilter: "gateway." }),
      ).toEqual({ actionFilter: "gateway." });
    });
  });
});

describe("given a deep-linked reader who wants to go back", () => {
  describe("when the kind has a detail route", () => {
    /** @scenario A deep-linked reader is offered the way back to the resource */
    it("addresses the resource under the project they are in", () => {
      expect(
        auditBackLink({
          target: { targetKind: "virtual_key", targetId: "vk_1" },
          projectSlug: "web-app",
        }),
      ).toEqual({ href: "/web-app/gateway/virtual-keys/vk_1", label: "Virtual key" });
    });
  });

  describe("when the kind is one of the list-only surfaces", () => {
    /**
     * `provider_binding` and `cache_rule` have no `[id]` route, so a back-link
     * would 404 — which reads as the resource having been deleted rather than
     * as a link we should not have offered.
     */
    /** @scenario A deep-linked reader is offered the way back to the resource */
    it("offers nothing rather than a link that 404s", () => {
      expect(
        auditBackLink({
          target: { targetKind: "cache_rule", targetId: "cr_1" },
          projectSlug: "web-app",
        }),
      ).toBeNull();
      expect(
        auditBackLink({
          target: { targetKind: "provider_binding", targetId: "pb_1" },
          projectSlug: "web-app",
        }),
      ).toBeNull();
    });
  });

  describe("when no project is in scope", () => {
    /** @scenario A deep-linked reader is offered the way back to the resource */
    it("offers nothing, because the address needs a project slug", () => {
      expect(
        auditBackLink({
          target: { targetKind: "budget", targetId: "b_1" },
          projectSlug: void 0,
        }),
      ).toBeNull();
    });
  });
});

describe("given a reader who changes a filter", () => {
  describe("when the next address is written", () => {
    /**
     * Page four of the old filter is not page four of the new one, and leaving
     * the offset behind is how a reader lands on an empty table and concludes
     * there is nothing to see.
     */
    /** @scenario Changing a filter returns the table to its first page */
    it("returns to the first page", () => {
      expect(withAuditFilter({ pageOffset: "75", period: "7d" }, { actionFilter: "x" })).toEqual({
        pageOffset: "0",
        period: "7d",
        actionFilter: "x",
      });
    });
  });

  describe("when the page size changes", () => {
    /** @scenario Changing a filter returns the table to its first page */
    it("starts the walk over, because an offset counts rows at the old size", () => {
      expect(withAuditPageSize({ pageOffset: "75" }, 100)).toEqual({
        pageOffset: "0",
        pageSize: "100",
      });
    });
  });

  describe("when the reader steps back past the beginning", () => {
    /** @scenario The audit table pages by offsets carried in the address */
    it("clamps to the first page", () => {
      expect(withAuditPageOffset({}, -25)).toEqual({ pageOffset: "0" });
    });
  });
});

describe("given the members the user box matches against", () => {
  const members = [
    { userId: "u-1", user: { name: "Alice Doe", email: "alice@example.com" } },
    { userId: "u-2", user: { name: null, email: "bob@example.com" } },
  ];

  describe("when a name is typed", () => {
    /** @scenario The user search resolves a typed name or address to one actor */
    it("matches case-insensitively on part of it", () => {
      expect(matchMemberId(members, "alice")).toBe("u-1");
      expect(matchMemberId(members, "DOE")).toBe("u-1");
    });
  });

  describe("when an address is typed", () => {
    /** @scenario The user search resolves a typed name or address to one actor */
    it("matches a member who has no name at all", () => {
      expect(matchMemberId(members, "bob@")).toBe("u-2");
    });
  });

  describe("when the box is empty or holds only spaces", () => {
    /** @scenario The user search resolves a typed name or address to one actor */
    it("applies no user filter", () => {
      expect(matchMemberId(members, "")).toBeUndefined();
      expect(matchMemberId(members, "   ")).toBeUndefined();
    });
  });

  describe("when nothing matches", () => {
    /** @scenario The user search resolves a typed name or address to one actor */
    it("applies no user filter rather than filtering to nobody", () => {
      expect(matchMemberId(members, "carol")).toBeUndefined();
    });
  });
});
