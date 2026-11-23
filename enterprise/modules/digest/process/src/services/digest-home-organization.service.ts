// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  type OrganizationWeek,
  pickHomeOrganization,
  weekActivity,
} from "../rules/digest-email.rules.ts";
import type { DigestWeekService } from "./digest-week.service.ts";

/** A member's standing when their email is sent, which may differ from the plan's. */
export type Membership = Readonly<{ kind: "active"; admin: boolean }> | Readonly<{ kind: "gone" }>;

/** No home means there was no organization to rank: an outcome of ranking, not a lookup miss. */
export type HomeRanking =
  | Readonly<{ kind: "home"; organizationId: string }>
  | Readonly<{ kind: "no-home" }>;

type Deps = Readonly<{
  weeks: Pick<DigestWeekService, "organizationWeek">;
  membership: (input: { organizationId: string; userId: string }) => Promise<Membership>;
  visibleWeek: (input: { week: OrganizationWeek; userId: string }) => Promise<OrganizationWeek>;
}>;

const homeRanking = (organizationId: string | undefined): HomeRanking =>
  organizationId === undefined ? { kind: "no-home" } : { kind: "home", organizationId };

/**
 * Which of a person's organizations is their home, the one that sends their weekly email: ranks
 * their organizations by the week's activity they may view, and checks a stored home still holds.
 */
export class DigestHomeOrganizationService {
  static create(deps: Deps): DigestHomeOrganizationService {
    return new DigestHomeOrganizationService(deps);
  }

  private constructor(private readonly deps: Deps) {}

  /**
   * A person in several enrolled organizations gets one email a week, from the home the plan
   * stored; with none, or one that can no longer send (unenrolled, or they left), the send ranks
   * the organizations they are still in.
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
    if (homeOrganizationId !== null && enrolled.includes(homeOrganizationId)) {
      const standing = await this.deps.membership({ organizationId: homeOrganizationId, userId });
      if (standing.kind === "active") return false;
    }
    const candidates = [organizationId];
    for (const other of enrolled.filter((id) => id !== organizationId)) {
      const standing = await this.deps.membership({ organizationId: other, userId });
      if (standing.kind === "active") candidates.push(other);
    }
    const home = await this.rankHome({ userId, isoWeek, candidates });
    return home.kind === "home" && home.organizationId === organizationId;
  }

  /**
   * Of the organizations a person is in, the one where their week had the most activity (lowest
   * id on a tie).
   */
  async rankHome({
    userId,
    isoWeek,
    candidates,
  }: {
    userId: string;
    isoWeek: string;
    candidates: readonly string[];
  }): Promise<HomeRanking> {
    if (candidates.length <= 1) return homeRanking(candidates[0]);
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
    return homeRanking(pickHomeOrganization(ranked));
  }
}
