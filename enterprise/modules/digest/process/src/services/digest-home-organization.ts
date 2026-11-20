// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  type OrganizationWeek,
  pickHomeOrganization,
  weekActivity,
} from "../rules/digest-email.rules.ts";
import type { DigestWeekService } from "./digest-week.service.ts";

/** A member's standing when their email is sent, which may differ from the plan's. */
export type Membership = Readonly<{ kind: "active"; admin: boolean }> | Readonly<{ kind: "gone" }>;

type Deps = Readonly<{
  weeks: Pick<DigestWeekService, "organizationWeek">;
  membership: (input: { organizationId: string; userId: string }) => Promise<Membership>;
  visibleWeek: (input: { week: OrganizationWeek; userId: string }) => Promise<OrganizationWeek>;
}>;

/**
 * Which of a person's organizations is their home, the one that sends their weekly email.
 * Private to the send service.
 */
export class DigestHomeOrganization {
  static create(deps: Deps): DigestHomeOrganization {
    return new DigestHomeOrganization(deps);
  }

  private constructor(private readonly deps: Deps) {}

  /**
   * A person in several enrolled organizations is sent one email a week, from the home the plan
   * stored on the request. With none stored (a request asked before it was), or a stored home
   * that can no longer send (unenrolled, or the person left it), the send ranks the
   * organizations they are still in now.
   */
  async isHomeOrganization({
    organizationId,
    userId,
    isoWeek,
    enrolled,
    homeOrganizationId,
  }: {
    organizationId: string;
    userId: string;
    isoWeek: string;
    enrolled: readonly string[];
    homeOrganizationId: string | null;
  }): Promise<boolean> {
    if (homeOrganizationId === organizationId) return true;
    if (
      homeOrganizationId !== null &&
      enrolled.includes(homeOrganizationId) &&
      (
        await this.deps.membership({ organizationId: homeOrganizationId, userId })
      ).kind === "active"
    ) {
      return false;
    }
    const candidates = [organizationId];
    for (const other of enrolled.filter((id) => id !== organizationId)) {
      const standing = await this.deps.membership({ organizationId: other, userId });
      if (standing.kind === "active") candidates.push(other);
    }
    return (await this.rankHome({ userId, isoWeek, candidates })) === organizationId;
  }

  /**
   * Of the organizations a person is in, the one where their week had the most activity (lowest
   * id on a tie); none when there are no candidates.
   */
  async rankHome({
    userId,
    isoWeek,
    candidates,
  }: {
    userId: string;
    isoWeek: string;
    candidates: readonly string[];
  }): Promise<string | undefined> {
    if (candidates.length <= 1) return candidates[0];
    const ranked = await Promise.all(
      candidates.map(async (candidate) => ({
        organizationId: candidate,
        activity: weekActivity({
          week: await this.deps.visibleWeek({
            week: await this.deps.weeks.organizationWeek({ organizationId: candidate, isoWeek }),
            userId,
          }),
          userId,
        }),
      })),
    );
    return pickHomeOrganization(ranked);
  }
}
