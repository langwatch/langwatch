import { describe, expect, it, vi } from "vitest";

import {
  ORPHANED_ORGANIZATION_WINDOW_MS,
  resolveSignUpHealth,
} from "../sign-up-health";
import {
  type SignUpHealthRepository,
  SignUpHealthService,
} from "../sign-up-health.service";

/**
 * The number join-before-create exists to move: how many of the organizations
 * people made they did not mean to make (D12).
 *
 * The sharp part is not the arithmetic, it is WHERE the number comes from. It
 * is derived from rows that have been written since long before this
 * deliverable, which is what lets an operator ask about a window that closed
 * before the flag was ever turned on. A counter could only answer for the
 * period after somebody added it, and "was this better or worse before" is
 * the only question worth asking of a number that justifies a change.
 *
 * Spec: specs/identity/join-before-create.feature
 */

const DAY = 24 * 60 * 60 * 1000;
/** Long before anybody turned the flag on. */
const LAST_YEAR = Date.parse("2025-06-01T00:00:00.000Z");

describe("given organizations founded by people who joined their real team later", () => {
  describe("when the rate is worked out", () => {
    /** @scenario Organizations nobody meant to create are countable across the change */
    it("counts the ones whose founder joined elsewhere inside thirty days", () => {
      const health = resolveSignUpHealth({
        founded: [
          {
            organizationId: "org_orphan",
            founderUserId: "user_sam",
            foundedAtMs: LAST_YEAR,
          },
          {
            organizationId: "org_kept",
            founderUserId: "user_ana",
            foundedAtMs: LAST_YEAR,
          },
        ],
        laterMemberships: [
          {
            organizationId: "org_acme",
            userId: "user_sam",
            joinedAtMs: LAST_YEAR + 5 * DAY,
          },
        ],
        fromMs: LAST_YEAR - DAY,
        toMs: LAST_YEAR + DAY,
      });

      expect(health.organizationsFounded).toBe(2);
      expect(health.orphanedOrganizations).toBe(1);
      expect(health.orphanedRate).toBe(0.5);
    });

    /** @scenario Organizations nobody meant to create are countable across the change */
    it("stops counting at thirty days", () => {
      const founded = [
        {
          organizationId: "org_one",
          founderUserId: "user_sam",
          foundedAtMs: LAST_YEAR,
        },
      ];

      expect(
        resolveSignUpHealth({
          founded,
          laterMemberships: [
            {
              organizationId: "org_acme",
              userId: "user_sam",
              joinedAtMs: LAST_YEAR + ORPHANED_ORGANIZATION_WINDOW_MS + DAY,
            },
          ],
          fromMs: LAST_YEAR - DAY,
          toMs: LAST_YEAR + DAY,
        }).orphanedOrganizations,
      ).toBe(0);
    });

    it("does not count the organization the founder made as somewhere they joined", () => {
      expect(
        resolveSignUpHealth({
          founded: [
            {
              organizationId: "org_one",
              founderUserId: "user_sam",
              foundedAtMs: LAST_YEAR,
            },
          ],
          // The membership `createAndAssign` writes for the founder itself.
          laterMemberships: [
            {
              organizationId: "org_one",
              userId: "user_sam",
              joinedAtMs: LAST_YEAR,
            },
          ],
          fromMs: LAST_YEAR - DAY,
          toMs: LAST_YEAR + DAY,
        }).orphanedOrganizations,
      ).toBe(0);
    });

    it("reports zero rather than a division by nothing for an empty period", () => {
      const health = resolveSignUpHealth({
        founded: [],
        laterMemberships: [],
        fromMs: LAST_YEAR,
        toMs: LAST_YEAR + DAY,
      });

      expect(health.orphanedRate).toBe(0);
      expect(health.organizationsFounded).toBe(0);
    });
  });
});

describe("given the sign-up health reporting", () => {
  describe("when a window that closed before the flag went on is read", () => {
    /** @scenario Organizations nobody meant to create are countable across the change */
    it("answers for that window, off rows nobody had to instrument", async () => {
      const repository = {
        findAllFoundedBetween: vi.fn(async () => [
          {
            organizationId: "org_orphan",
            founderUserId: "user_sam",
            foundedAtMs: LAST_YEAR,
          },
        ]),
        findAllSameDomainMembershipsSince: vi.fn(async () => [
          {
            organizationId: "org_acme",
            userId: "user_sam",
            joinedAtMs: LAST_YEAR + 3 * DAY,
          },
        ]),
      } satisfies SignUpHealthRepository;

      const health = await new SignUpHealthService({
        repository,
      }).getOrphanedOrganizationRate({
        fromMs: LAST_YEAR - DAY,
        toMs: LAST_YEAR + DAY,
      });

      expect(health).toMatchObject({
        organizationsFounded: 1,
        orphanedOrganizations: 1,
        orphanedRate: 1,
        fromMs: LAST_YEAR - DAY,
        toMs: LAST_YEAR + DAY,
      });
    });

    /** @scenario Organizations nobody meant to create are countable across the change */
    it("looks thirty days past the window for the joins that orphan it", async () => {
      const repository = {
        findAllFoundedBetween: vi.fn(async () => [
          {
            organizationId: "org_orphan",
            founderUserId: "user_sam",
            foundedAtMs: LAST_YEAR + DAY,
          },
        ]),
        findAllSameDomainMembershipsSince: vi.fn(async () => []),
      } satisfies SignUpHealthRepository;

      await new SignUpHealthService({ repository }).getOrphanedOrganizationRate(
        { fromMs: LAST_YEAR, toMs: LAST_YEAR + DAY },
      );

      // Cutting the second read at the same instant as the first would report
      // the most recent month as healthier than it is, every time.
      expect(repository.findAllSameDomainMembershipsSince).toHaveBeenCalledWith(
        {
          founderUserIds: ["user_sam"],
          sinceMs: LAST_YEAR,
          untilMs: LAST_YEAR + DAY + ORPHANED_ORGANIZATION_WINDOW_MS,
        },
      );
    });
  });
});
