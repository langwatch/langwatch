import {
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "./connection.ts";
import type { GuardMiddleware, GuardNext, GuardParams } from "./guard-middleware.ts";
import { guardEnMasse } from "./mass-delete-guard.ts";
import { type OnSkippedTenantCheck, projectGuard } from "./multi-tenancy-guard.ts";
import { guardOrganizationId } from "./organization-guard.ts";

/**
 * Tenancy policy implementation: composes mass-delete, project, and org guards in order.
 * Timing and environment reads are handled at the composition root.
 */
export class PrismaTenancyGuardService extends PrismaQueryGuard {
  private constructor(private readonly guardProjectId: GuardMiddleware) {
    super();
  }

  /** `onSkippedTenantCheck` hears each raw statement that set `SKIP_TENANT_CHECK`, to count it. */
  static create({
    onSkippedTenantCheck = () => {},
  }: { onSkippedTenantCheck?: OnSkippedTenantCheck } = {}): PrismaTenancyGuardService {
    return new PrismaTenancyGuardService(projectGuard({ onSkippedTenantCheck }));
  }

  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    const params: GuardParams = {
      ...(context.model === void 0 ? {} : { model: context.model }),
      action: context.action,
      args: context.args,
    };
    const run: GuardNext = (current) =>
      this.guardProjectId(current, (projectGuarded) =>
        guardOrganizationId(projectGuarded, (organizationGuarded) =>
          next(organizationGuarded.args),
        ),
      );
    return guardEnMasse(params, run);
  }
}
