/**
 * The merge rule, on its own: which spend row is allowed to join which
 * discovered person, and what happens when the answer is ambiguous.
 *
 * The page test proves the table renders it. This proves the rule itself,
 * including the cases a screenshot would never show — an erased pseudonym that
 * happens to collide with a live actor, and money two providers both claim.
 *
 * Spec: specs/governance/governance-people-screen.feature
 */
import { describe, expect, it } from "vitest";

import {
  type DiscoveredFacts,
  departmentsPresent,
  filterByDepartment,
  mergePeopleRows,
  type SpendFacts,
} from "../peopleRows";

const seenAt = new Date("2026-08-01T00:00:00.000Z");

const person = (over: Partial<DiscoveredFacts>): DiscoveredFacts => ({
  id: over.id ?? "person-1",
  provider: "openai_admin",
  kind: "person",
  displayText: "Someone",
  rawActorId: "someone@example.com",
  directoryDepartment: null,
  firstSeenAt: seenAt,
  lastSeenAt: seenAt,
  erasedAt: null,
  suspendedAt: null,
  suspendedReason: null,
  link: null,
  ...over,
});

const spend = (over: Partial<SpendFacts>): SpendFacts => ({
  actor: "someone@example.com",
  spendUsd: "10",
  requests: 100,
  lastActivityIso: seenAt.toISOString(),
  mostUsedTarget: null,
  ...over,
});

const merge = ({
  spend: spendRows = [],
  discovered = [],
  department = null,
  memberName = null,
}: {
  spend?: SpendFacts[];
  discovered?: DiscoveredFacts[];
  department?: string | null;
  memberName?: string | null;
}) =>
  mergePeopleRows({
    spend: spendRows,
    discovered,
    departmentForActor: () => department,
    memberNameForActor: () => memberName,
  });

describe("merging the spend read with the discovered people", () => {
  describe("when exactly one discovered person carries the spend actor", () => {
    it("returns one row holding both the money and the provider", () => {
      const rows = merge({
        spend: [spend({})],
        discovered: [person({ displayText: "Someone Real" })],
      });

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        displayName: "Someone Real",
        provider: "openai_admin",
        spendUsd: 10,
        requests: 100,
      });
    });
  });

  describe("when two providers carry the same identifier", () => {
    const twoProviders = [
      person({ id: "a", provider: "openai_admin", displayText: "M Silva" }),
      person({ id: "b", provider: "anthropic_admin", displayText: "M Silva" }),
    ];

    it("keeps them two rows and puts the money on neither", () => {
      const rows = merge({ spend: [spend({})], discovered: twoProviders });

      expect(rows).toHaveLength(3);
      expect(rows.filter((row) => row.spendUsd !== null)).toHaveLength(1);
      const withMoney = rows.find((row) => row.spendUsd !== null);
      expect(withMoney?.provider).toBeNull();
      expect(
        rows.filter((row) => row.provider !== null).map((row) => row.provider),
      ).toEqual(["openai_admin", "anthropic_admin"]);
    });
  });

  describe("when an erased pseudonym collides with a live spend actor", () => {
    it("never joins them, so the money stays off the erased row", () => {
      const rows = merge({
        spend: [spend({ actor: "pseudonym_x" })],
        discovered: [
          person({
            id: "erased",
            displayText: "pseudonym_x",
            rawActorId: "pseudonym_x",
            directoryDepartment: "Engineering",
            erasedAt: seenAt,
          }),
        ],
      });

      const erased = rows.find((row) => row.status === "erased");
      expect(erased).toMatchObject({
        spendUsd: null,
        identifier: null,
        provider: null,
        department: null,
      });
    });
  });

  describe("when nothing metered a discovered person", () => {
    it("carries no spend but keeps when the provider last saw them", () => {
      const rows = merge({ discovered: [person({})] });

      expect(rows[0]).toMatchObject({ spendUsd: null, requests: null });
      expect(rows[0]?.lastActiveIso).toBe(seenAt.toISOString());
    });
  });

  describe("when a spend actor is an organization member", () => {
    it("reads as matched even with no identity link behind it", () => {
      const rows = merge({ spend: [spend({})], memberName: "Jane Doe" });

      expect(rows[0]).toMatchObject({
        status: "matched",
        matchDetail: "Jane Doe",
      });
    });
  });

  describe("when a link names its proof", () => {
    it("carries the evidence kind onto the row", () => {
      const rows = merge({
        discovered: [
          person({
            link: {
              userId: "user-1",
              evidenceKind: "verified_email",
              memberName: "Jane Doe",
              departmentName: "Finance",
            },
          }),
        ],
      });

      expect(rows[0]).toMatchObject({
        status: "matched",
        evidenceKind: "verified_email",
        department: "Finance",
        linkedUserId: "user-1",
      });
    });
  });
});

describe("the department filter", () => {
  const rows = merge({
    discovered: [
      person({ id: "a", displayText: "A", directoryDepartment: "Engineering" }),
      person({ id: "b", displayText: "B", directoryDepartment: "Finance" }),
      person({ id: "c", displayText: "C" }),
    ],
  });

  describe("when the chip lists what it can offer", () => {
    it("names every department a row shows, sorted, without repeats", () => {
      expect(departmentsPresent(rows)).toEqual(["Engineering", "Finance"]);
    });
  });

  describe("when one department is chosen", () => {
    it("leaves only that department's rows", () => {
      expect(
        filterByDepartment({ rows, department: "Engineering" }).map(
          (row) => row.displayName,
        ),
      ).toEqual(["A"]);
    });
  });

  describe("when no department is chosen", () => {
    it("leaves every row, including the people who have none", () => {
      expect(filterByDepartment({ rows, department: null })).toHaveLength(3);
    });
  });
});
