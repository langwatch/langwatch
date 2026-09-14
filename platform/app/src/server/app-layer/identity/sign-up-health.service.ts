import {
  type FoundedOrganization,
  type LaterMembership,
  ORPHANED_ORGANIZATION_WINDOW_MS,
  resolveSignUpHealth,
  type SignUpHealth,
} from "./sign-up-health";

/** What the rate is read from. A port rather than Prisma, like every other
 *  service here: the arithmetic is testable without a database. */
export interface SignUpHealthRepository {
  findAllFoundedBetween(args: {
    fromMs: number;
    toMs: number;
  }): Promise<FoundedOrganization[]>;
  findAllSameDomainMembershipsSince(args: {
    founderUserIds: readonly string[];
    sinceMs: number;
    untilMs: number;
  }): Promise<LaterMembership[]>;
}

/**
 * How many of the organizations people made they did not mean to make (D12).
 *
 * The number join-before-create exists to move, and the reason it is derived
 * from stored rows rather than counted live: a counter cannot answer for the
 * period before somebody added it, and "was this better or worse before the
 * flag" is the only question worth asking of a number that justifies a
 * change. Any window is readable, including every window before this
 * deliverable shipped.
 */
export class SignUpHealthService {
  constructor(
    private readonly deps: {
      repository: SignUpHealthRepository;
      now?: () => number;
    },
  ) {}

  /**
   * The orphaned-organization rate for a window.
   *
   * The membership read runs to `toMs + thirty days`, not to `toMs`: an
   * organization founded on the last day of the window is only orphaned by
   * something that happens after it, so cutting the second read at the same
   * instant as the first would report the most recent month as healthier than
   * it is, every time.
   */
  async getOrphanedOrganizationRate({
    fromMs,
    toMs,
  }: {
    fromMs: number;
    toMs: number;
  }): Promise<SignUpHealth> {
    const founded = await this.deps.repository.findAllFoundedBetween({
      fromMs,
      toMs,
    });
    const laterMemberships =
      await this.deps.repository.findAllSameDomainMembershipsSince({
        founderUserIds: [
          ...new Set(founded.map((organization) => organization.founderUserId)),
        ],
        sinceMs: fromMs,
        untilMs: toMs + ORPHANED_ORGANIZATION_WINDOW_MS,
      });

    return resolveSignUpHealth({
      founded,
      laterMemberships,
      fromMs,
      toMs,
    });
  }
}
