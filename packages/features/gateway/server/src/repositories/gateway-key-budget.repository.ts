import type { GatewayBudget } from "@langwatch/gateway-contract";
import type { GatewayPersistenceTransaction } from "../ports/gateway-change-events.port";

/** The cap fields a key's own drawer sets. */
export type GatewayKeyBudgetFields = {
  name: string;
  window: GatewayBudget["window"];
  limitUsd: string;
  onBreach: "BLOCK" | "WARN";
  /** Always null: enforcement computes resets in UTC only. */
  timezone: null;
};

/**
 * Which of a key's caps a lifecycle change carries. `drawerManaged` is the
 * one row the key's own drawer owns; `scopedToKey` is every cap that can only
 * ever have counted this key's traffic, which is what a dead key retires.
 */
export type GatewayKeyBudgetScope = "drawerManaged" | "scopedToKey";

/**
 * The `GatewayBudget` rows a virtual key's lifecycle creates and retires. Kept
 * apart from the budgets catalogue: these are the rows the key's own drawer
 * manages, written inside the same transaction as the key itself.
 */
export abstract class GatewayKeyBudgetRepository {
  /** The one live row this key's drawer manages, if it has one. */
  abstract tryFindDrawerManaged(
    input: { organizationId: string; virtualKeyId: string },
    transaction?: GatewayPersistenceTransaction,
  ): Promise<GatewayBudget | null>;
  abstract createForKey(
    input: {
      organizationId: string;
      virtualKeyId: string;
      createdById: string;
      resetsAt: Date;
      fields: GatewayKeyBudgetFields;
    },
    transaction?: GatewayPersistenceTransaction,
  ): Promise<GatewayBudget>;
  /** `resetsAt` moves only when the window changes under it. */
  abstract updateForKey(
    input: { id: string; resetsAt?: Date; fields: GatewayKeyBudgetFields },
    transaction?: GatewayPersistenceTransaction,
  ): Promise<GatewayBudget>;
  abstract findActiveForKey(
    input: { organizationId: string; virtualKeyId: string; scope: GatewayKeyBudgetScope },
    transaction?: GatewayPersistenceTransaction,
  ): Promise<GatewayBudget[]>;
  abstract archive(
    input: { id: string; archivedAt: Date },
    transaction?: GatewayPersistenceTransaction,
  ): Promise<GatewayBudget>;
}
