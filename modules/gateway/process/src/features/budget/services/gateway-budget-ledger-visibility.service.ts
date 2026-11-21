/**
 * What of a budget's detail a caller sees (gateway-budget-service.feature). The door asks
 * `gatewayBudgets:view`; this rule depends on the loaded budget and each row's key, so the
 * service asks the rest.
 */
import { GatewayBudgetNotFoundError, type GatewayBudgetDetail } from "@langwatch/gateway-contract";

import type { GatewayUserDirectoryChannel } from "../../../channels/gateway-user-directory.channel.ts";
import type { BudgetDetail } from "../../../repositories/gateway-budget.repository.ts";
import {
  hangsOnItsCreator,
  isMarkedPersonal,
  type VirtualKeyOwnership,
} from "../../../rules/gateway-personal-key.rules.ts";
import type { GatewayScopePermissions } from "../../virtual-key/services/virtual-key-authorization.service.ts";

type LedgerRow = BudgetDetail["recentLedger"][number];
type ShownRow = GatewayBudgetDetail["recentLedger"][number];

/** How many recent ledger rows the detail screen lists. */
const RECENT_LEDGER_SHOWN = 20;

type Dependencies = Readonly<{
  permissions: Pick<GatewayScopePermissions, "sessionHolds">;
  users: GatewayUserDirectoryChannel;
}>;

export class GatewayBudgetLedgerVisibilityService {
  static create(dependencies: Dependencies): GatewayBudgetLedgerVisibilityService {
    return new GatewayBudgetLedgerVisibilityService(dependencies);
  }

  private constructor(private readonly dependencies: Dependencies) {}

  /**
   * A budget scoped to one person, or to a personal key, opens only for that person and holders
   * of `virtualKeys:viewOtherPersonal`; anyone else is told it does not exist. Its newest rows
   * follow the same rule per key, and each leaves without its key's owner.
   */
  async detailFor({
    organizationId,
    actorUserId,
    detail,
  }: {
    organizationId: string;
    actorUserId: string;
    detail: BudgetDetail;
  }): Promise<GatewayBudgetDetail> {
    const gone = await this.goneCreators({
      owners: [...detail.recentLedger.map(({ keyOwner }) => keyOwner), detail.scopeKeyOwner],
    });
    let asked: Promise<boolean> | undefined;
    const seesOthers = (): Promise<boolean> => {
      asked ??= this.dependencies.permissions.sessionHolds({
        userId: actorUserId,
        permission: "virtualKeys:viewOtherPersonal",
        scope: { type: "org", id: organizationId },
      });
      return asked;
    };

    const budgetOwner = personalBudgetOwner({ detail, gone });
    if (budgetOwner !== undefined && budgetOwner !== actorUserId && !(await seesOthers())) {
      throw new GatewayBudgetNotFoundError();
    }
    const othersPersonal = detail.recentLedger.filter(
      ({ keyOwner }) =>
        isPersonal({ owner: keyOwner, gone }) && keyOwner?.principalUserId !== actorUserId,
    );
    const shown = othersPersonal.length === 0 || (await seesOthers());

    return {
      budget: detail.budget,
      scopeTarget: detail.scopeTarget,
      spendAvailable: detail.spendAvailable,
      unreachableByAnyKey: detail.unreachableByAnyKey,
      recentLedger: detail.recentLedger
        .filter((row) => shown || !othersPersonal.includes(row))
        .slice(0, RECENT_LEDGER_SHOWN)
        .map(withoutOwner),
    };
  }

  /**
   * The creators whose accounts are gone, asked once each. A failed lookup throws, so an outage
   * fails the read rather than counting an account as gone.
   */
  private async goneCreators({
    owners,
  }: {
    owners: readonly (VirtualKeyOwnership | null)[];
  }): Promise<ReadonlySet<string>> {
    const creators = new Set(
      owners.flatMap((owner) => (owner && hangsOnItsCreator(owner) ? [owner.createdById] : [])),
    );
    const answers = await Promise.all(
      [...creators].map(async (userId) => ({
        userId,
        exists: await this.dependencies.users.accountExists({ userId }),
      })),
    );
    return new Set(answers.filter(({ exists }) => !exists).map(({ userId }) => userId));
  }
}

/** Marked personal, hanging on a creator whose account is gone, or unreadable (fails closed). */
function isPersonal({
  owner,
  gone,
}: {
  owner: VirtualKeyOwnership | null;
  gone: ReadonlySet<string>;
}): boolean {
  return (
    owner === null ||
    isMarkedPersonal(owner) ||
    (hangsOnItsCreator(owner) && gone.has(owner.createdById))
  );
}

/** The person a budget belongs to, null when no one can be named, undefined when it is shared. */
function personalBudgetOwner({
  detail,
  gone,
}: {
  detail: BudgetDetail;
  gone: ReadonlySet<string>;
}): string | null | undefined {
  if (detail.budget.scopeType === "PRINCIPAL") return detail.budget.scopeId;
  if (detail.budget.scopeType !== "VIRTUAL_KEY") return undefined;
  const owner = detail.scopeKeyOwner;
  return isPersonal({ owner, gone }) ? (owner?.principalUserId ?? null) : undefined;
}

function withoutOwner({
  id,
  virtualKeyId,
  amountUsd,
  model,
  status,
  occurredAt,
  virtualKey,
}: LedgerRow): ShownRow {
  return { id, virtualKeyId, amountUsd, model, status, occurredAt, virtualKey };
}
