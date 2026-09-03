import { guardEnMasse } from "./mass-delete-guard";
import type { GuardNext, GuardParams } from "./guard-middleware";
import { guardProjectId } from "./multi-tenancy-guard";
import { guardOrganizationId } from "./organization-guard";
import { PrismaQueryGuard, type PrismaQueryContext, type PrismaQueryExecutor } from "./connection";

/**
 * The tenancy policy every LangWatch process composes its client with.
 *
 * {@link PrismaQueryGuard} is the port that makes an unguarded client
 * unconstructable; this is the one implementation of it, and it lives beside
 * the schema its model classification is a projection of. The three guards run
 * in the order they were registered as Prisma middleware, because that order
 * is behaviour: mass-delete refuses an unbounded `deleteMany` before either
 * tenancy guard inspects a WHERE clause that would never run, and the project
 * guard hands the organization guard the arguments it narrowed.
 *
 * It composes no timing and reads no environment. A process that wants its
 * slow queries reported decorates this guard at its own composition root,
 * which is where the budget it reports against is configured.
 */
export class PrismaTenancyGuardService extends PrismaQueryGuard {
  private constructor() {
    super();
  }

  static create(): PrismaTenancyGuardService {
    return new PrismaTenancyGuardService();
  }

  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    const params: GuardParams = {
      ...(context.model === void 0 ? {} : { model: context.model }),
      action: context.action,
      args: context.args,
    };
    const run: GuardNext = (current) =>
      guardProjectId(current, (projectGuarded) =>
        guardOrganizationId(projectGuarded, (organizationGuarded) =>
          next(organizationGuarded.args),
        ),
      );
    return guardEnMasse(params, run);
  }
}
