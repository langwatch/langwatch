import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { PlatformOperatorPort } from "../../ports/platform-operator.port";
import type { SsoPlatformOperatorRepository } from "../sso-connection.repository";

/** The one model an operator check reads, and no other. */
export type PrismaSsoPlatformOperatorDatabase = Pick<PrismaClient, "user">;

/**
 * Who counts as a LangWatch platform operator, for the guards that refuse an organization
 * administrator's hand (D05 tier 1). The answer is `ADMIN_EMAILS`, which is what already decides
 * who reaches the back office at all — deliberately, and not `ops:*`.
 */
export class AdminEmailPlatformOperatorsRepository implements SsoPlatformOperatorRepository {
  /**
   * The operator list arrives as a port rather than being read here. `ADMIN_EMAILS` is the
   * deployment's variable, not this package's, and two packages reading it through two different
   * accessors is how one of them ends up with a different operator list than the other.
   */
  static create({
    database,
    operators,
  }: {
    database: PrismaSsoPlatformOperatorDatabase;
    operators: PlatformOperatorPort;
  }): AdminEmailPlatformOperatorsRepository {
    return new AdminEmailPlatformOperatorsRepository(database, operators);
  }

  private constructor(
    private readonly prisma: PrismaSsoPlatformOperatorDatabase,
    private readonly operators: PlatformOperatorPort,
  ) {}

  async isPlatformOperator({ actorId }: { actorId: string }): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { email: true },
    });
    if (!user) return false;
    return this.operators.isPlatformOperatorEmail({ email: user.email });
  }
}

/**
 * The answer when there is no person to ask about — the grandfather migration's system actor, and
 * any other caller that is the platform itself.
 */
export class SystemActorPlatformOperatorsRepository implements SsoPlatformOperatorRepository {
  static create(): SystemActorPlatformOperatorsRepository {
    return new SystemActorPlatformOperatorsRepository();
  }

  async isPlatformOperator(_args: { actorId: string }): Promise<boolean> {
    return true;
  }
}
