/**
 * The cap a virtual key carries on itself. Created and updated in the same transaction as the key,
 * and archived rather than deleted when the key dies, so the ledger rows behind a retired cap stay
 * readable against the budget they were spent under.
 */

import {
  serializeRowForAudit,
  GatewayWindow,
  type GatewayBudget,
} from "@langwatch/gateway-contract";
import { GatewayAuditPort } from "../ports/gateway-audit.port.ts";
import { GatewayChangeEventsPort } from "../ports/gateway-change-events.port.ts";
import type { GatewayPersistenceTransaction } from "../ports/gateway-change-events.port.ts";
import type {
  GatewayKeyBudgetRepository,
  GatewayKeyBudgetScope,
} from "../repositories/gateway-key-budget.repository.ts";
import type { VirtualKeyWithScopes } from "../ports/gateway-virtual-key.port.ts";
import type { VirtualKeyBudgetInput } from "./virtual-key-validation.service.ts";
import { fromDate, nowInstant } from "@langwatch/time";

export class VirtualKeyBudgetService {
  private constructor(
    private readonly keyBudgets: GatewayKeyBudgetRepository,
    private readonly changeEvents: GatewayChangeEventsPort,
    private readonly auditLog: GatewayAuditPort,
  ) {}

  static create(input: {
    keyBudgets: GatewayKeyBudgetRepository;
    changeEvents: GatewayChangeEventsPort;
    auditLog: GatewayAuditPort;
  }): VirtualKeyBudgetService {
    return new VirtualKeyBudgetService(input.keyBudgets, input.changeEvents, input.auditLog);
  }

  /**
   * Create or update the budget targeted at this key. Runs inside the caller's
   * transaction so a key and its cap land together or not at all.
   */
  async upsertKeyBudget(
    args: {
      virtualKey: VirtualKeyWithScopes;
      budget: VirtualKeyBudgetInput;
      actorUserId: string;
    },
    tx: GatewayPersistenceTransaction,
  ): Promise<GatewayBudget> {
    const { virtualKey: vk, budget, actorUserId } = args;
    // The drawer manages exactly one budget row, identified by explicit
    // linkage rather than by shape: matching on target/window would also
    // catch caps created independently on the Budgets page, whose
    // lifecycle (and delete permission) is not the drawer's to touch.
    const existing = await this.keyBudgets.tryFindDrawerManaged(
      { organizationId: vk.organizationId, virtualKeyId: vk.id },
      tx,
    );

    const fields = {
      name: budget.name ?? `${vk.name} budget`,
      window: budget.window,
      limitUsd: budget.limitUsd,
      onBreach: budget.onBreach ?? ("BLOCK" as const),
      // No timezone knob: enforcement computes resets in UTC only
      // (budgetWindow.ts), so accepting one here would store a setting
      // that changes nothing.
      timezone: null,
    };

    const row = existing
      ? await this.keyBudgets.updateForKey(
          {
            id: existing.id,
            fields,
            // Changing the window changes what "this period" means, so the
            // reset instant has to be recomputed with it.
            ...(existing.window !== budget.window
              ? { resetsAt: fromDate(GatewayWindow.nextResetAt(budget.window)) }
              : {}),
          },
          tx,
        )
      : await this.keyBudgets.createForKey(
          {
            organizationId: vk.organizationId,
            virtualKeyId: vk.id,
            createdById: actorUserId,
            resetsAt: fromDate(GatewayWindow.nextResetAt(budget.window)),
            fields,
          },
          tx,
        );

    await this.changeEvents.append(
      {
        organizationId: vk.organizationId,
        kind: existing ? "BUDGET_UPDATED" : "BUDGET_CREATED",
        budgetId: row.id,
        virtualKeyId: vk.id,
      },
      tx,
    );
    await this.auditLog.append(
      {
        organizationId: vk.organizationId,
        projectId: null,
        actorUserId,
        action: existing ? "gateway.budget.updated" : "gateway.budget.created",
        targetKind: "budget",
        targetId: row.id,
        ...(existing ? { before: serializeRowForAudit(existing) } : {}),
        after: serializeRowForAudit(row),
      },
      tx,
    );

    return row;
  }

  /**
   * Archive the budgets a key's lifecycle carries: `drawerManaged` archives
   * only the drawer's own row; `scopedToKey` (REVOKED) archives every budget
   * scoped only to it. Archive, not delete, so ledger rows stay readable.
   */
  async archiveKeyBudgets({
    vk,
    actorUserId,
    tx,
    include,
  }: {
    vk: VirtualKeyWithScopes;
    actorUserId: string;
    tx: GatewayPersistenceTransaction;
    include: GatewayKeyBudgetScope;
  }): Promise<void> {
    const budgets = await this.keyBudgets.findActiveForKey(
      { organizationId: vk.organizationId, virtualKeyId: vk.id, scope: include },
      tx,
    );
    for (const budget of budgets) {
      const archived = await this.keyBudgets.archive(
        { id: budget.id, archivedAt: nowInstant() },
        tx,
      );
      await this.changeEvents.append(
        {
          organizationId: vk.organizationId,
          kind: "BUDGET_DELETED",
          budgetId: archived.id,
          virtualKeyId: vk.id,
        },
        tx,
      );
      await this.auditLog.append(
        {
          organizationId: vk.organizationId,
          projectId: null,
          actorUserId,
          action: "gateway.budget.deleted",
          targetKind: "budget",
          targetId: archived.id,
          before: serializeRowForAudit(budget),
          after: serializeRowForAudit(archived),
        },
        tx,
      );
    }
  }
}
