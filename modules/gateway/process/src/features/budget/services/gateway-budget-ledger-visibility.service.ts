/**
 * Who may open a budget, and what of its detail they see (gateway-budget-service.feature). The
 * doors ask the budget permission; this rule depends on the stored budget and each row's key, so
 * the service asks the rest, for the detail screen, creates, edits, archives and REST alike.
 */
import {
  GatewayBudgetNotFoundError,
  GatewayScopeOrgMismatchError,
  VirtualKeyNotFoundError,
  type GatewayBudgetDetail,
  type GatewayBudgetReader,
  type GatewayBudgetScope,
} from "@langwatch/gateway-contract";

import type { GatewayUserDirectoryChannel } from "../../../channels/gateway-user-directory.channel.ts";
import type {
  BudgetDetail,
  BudgetScopeOwnership,
  GatewayBudgetRepository,
} from "../../../repositories/gateway-budget.repository.ts";
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

/** The only scopes a budget can be one person's through. */
const PERSONAL_SCOPE_TYPES = new Set(["PRINCIPAL", "VIRTUAL_KEY"]);

type Dependencies = Readonly<{
  permissions: Pick<GatewayScopePermissions, "sessionHolds" | "apiKeyHolds">;
  users: GatewayUserDirectoryChannel;
  budgets: Pick<GatewayBudgetRepository, "getScopeOwnership" | "findScopeKeyOwnership">;
}>;

export class GatewayBudgetLedgerVisibilityService {
  static create(dependencies: Dependencies): GatewayBudgetLedgerVisibilityService {
    return new GatewayBudgetLedgerVisibilityService(dependencies);
  }

  private constructor(private readonly dependencies: Dependencies) {}

  /**
   * A budget scoped to one member, or to a personal key, opens only for that person and holders
   * of `virtualKeys:viewOtherPersonal` at the organization; anyone else is told it does not exist.
   */
  async assertOpens({
    id,
    organizationId,
    reader,
  }: {
    id: string;
    organizationId: string;
    reader: GatewayBudgetReader;
  }): Promise<void> {
    const scope = await this.dependencies.budgets.getScopeOwnership({ id, organizationId });
    if (!PERSONAL_SCOPE_TYPES.has(scope.scopeType)) return;
    if (await this.seesOthers({ organizationId, reader })) return;
    const gone = await this.goneCreators({ owners: [scope.scopeKeyOwner] });
    refuseUnlessOpens({ scope, gone, reader });
  }

  /**
   * A budget is created only on a scope {@link assertOpens} would open for its creator afterwards.
   * Another person's scope is refused as an absent target is: a key as not found, a member as
   * outside the organization, so neither answer confirms the person or the key.
   */
  async assertScopeOpens({
    scope,
    organizationId,
    reader,
  }: {
    scope: GatewayBudgetScope;
    organizationId: string;
    reader: GatewayBudgetReader;
  }): Promise<void> {
    if (scope.kind !== "PRINCIPAL" && scope.kind !== "VIRTUAL_KEY") return;
    if (await this.seesOthers({ organizationId, reader })) return;
    const ownership: BudgetScopeOwnership =
      scope.kind === "PRINCIPAL"
        ? { scopeType: "PRINCIPAL", scopeId: scope.principalUserId, scopeKeyOwner: null }
        : {
            scopeType: "VIRTUAL_KEY",
            scopeId: scope.virtualKeyId,
            scopeKeyOwner: await this.dependencies.budgets.findScopeKeyOwnership({
              virtualKeyId: scope.virtualKeyId,
              organizationId,
            }),
          };
    const gone = await this.goneCreators({ owners: [ownership.scopeKeyOwner] });
    if (opensFor({ scope: ownership, gone, reader })) return;
    throw scope.kind === "PRINCIPAL"
      ? new GatewayScopeOrgMismatchError("user")
      : new VirtualKeyNotFoundError();
  }

  /**
   * The detail, opened as {@link assertOpens} does. Its newest rows follow the same rule per key,
   * and each leaves without its key's owner.
   */
  async detailFor({
    organizationId,
    reader,
    detail,
  }: {
    organizationId: string;
    reader: GatewayBudgetReader;
    detail: BudgetDetail;
  }): Promise<GatewayBudgetDetail> {
    const rows = (await this.seesOthers({ organizationId, reader }))
      ? detail.recentLedger
      : await this.ownOrSharedRows({ reader, detail });

    return {
      budget: detail.budget,
      scopeTarget: detail.scopeTarget,
      spendAvailable: detail.spendAvailable,
      unreachableByAnyKey: detail.unreachableByAnyKey,
      recentLedger: rows.slice(0, RECENT_LEDGER_SHOWN).map(withoutOwner),
    };
  }

  /** For a reader without the permission: refuses another's budget, else drops others' rows. */
  private async ownOrSharedRows({
    reader,
    detail,
  }: {
    reader: GatewayBudgetReader;
    detail: BudgetDetail;
  }): Promise<LedgerRow[]> {
    const gone = await this.goneCreators({
      owners: [...detail.recentLedger.map(({ keyOwner }) => keyOwner), detail.scopeKeyOwner],
    });
    const { scopeType, scopeId } = detail.budget;
    refuseUnlessOpens({
      scope: { scopeType, scopeId, scopeKeyOwner: detail.scopeKeyOwner },
      gone,
      reader,
    });

    return detail.recentLedger.filter(
      ({ keyOwner }) =>
        !isPersonal({ owner: keyOwner, gone }) ||
        isReader({ userId: keyOwner?.principalUserId, reader }),
    );
  }

  /** Whether the reader holds `virtualKeys:viewOtherPersonal` at the organization. */
  private seesOthers({
    organizationId,
    reader,
  }: {
    organizationId: string;
    reader: GatewayBudgetReader;
  }): Promise<boolean> {
    const permission = "virtualKeys:viewOtherPersonal";
    const scope = { type: "org", id: organizationId } as const;
    switch (reader.kind) {
      case "member":
        return this.dependencies.permissions.sessionHolds({
          userId: reader.userId,
          permission,
          scope,
        });
      case "apiKey":
        return this.dependencies.permissions.apiKeyHolds({
          apiKeyId: reader.apiKeyId,
          userId: reader.userId,
          organizationId,
          permission,
          scope,
        });
      case "projectKey":
        return Promise.resolve(false);
    }
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

/** Whether `userId` names the reader; a project key, or an API key with no user, is no one. */
function isReader({
  userId,
  reader,
}: {
  userId: string | null | undefined;
  reader: GatewayBudgetReader;
}): boolean {
  if (reader.kind === "projectKey" || !userId) return false;
  return reader.userId === userId;
}

/** Whether a budget belongs to one person; a personal key's budget may name no one. */
type BudgetOwnership =
  | { kind: "shared" }
  | { kind: "owned"; userId: string }
  | { kind: "ownerUnnamed" };

function budgetOwnership({
  scope,
  gone,
}: {
  scope: BudgetScopeOwnership;
  gone: ReadonlySet<string>;
}): BudgetOwnership {
  if (scope.scopeType === "PRINCIPAL") return { kind: "owned", userId: scope.scopeId };
  const owner = scope.scopeKeyOwner;
  if (scope.scopeType !== "VIRTUAL_KEY" || !isPersonal({ owner, gone })) {
    return { kind: "shared" };
  }
  return owner?.principalUserId
    ? { kind: "owned", userId: owner.principalUserId }
    : { kind: "ownerUnnamed" };
}

type ScopeReading = {
  scope: BudgetScopeOwnership;
  gone: ReadonlySet<string>;
  reader: GatewayBudgetReader;
};

/** For a reader without `virtualKeys:viewOtherPersonal`: shared, or the reader's own. */
function opensFor({ scope, gone, reader }: ScopeReading): boolean {
  const ownership = budgetOwnership({ scope, gone });
  if (ownership.kind === "shared") return true;
  return ownership.kind === "owned" && isReader({ userId: ownership.userId, reader });
}

/** For a reader without `virtualKeys:viewOtherPersonal`: another person's budget is not found. */
function refuseUnlessOpens(reading: ScopeReading): void {
  if (!opensFor(reading)) throw new GatewayBudgetNotFoundError();
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
