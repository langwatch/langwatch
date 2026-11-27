import { generate } from "@langwatch/ksuid";
import {
  AdminSubscriptionAlreadyActiveError,
  type AdminDataResult,
  type AdminListResult,
  type AdminOperationInput,
  type AdminOperationParams,
  type AdminOperationResult,
} from "@langwatch/ops-contract";

import { holdsLivePlanSlot } from "../../rules/subscription-live-plan.rules.ts";
import { InstanceAdminRepository } from "../instance-admin.repository.ts";
import type { MemoryOpsStore } from "./memory.ops.store.ts";

type AdminRow = Record<string, unknown>;

/**
 * The instance admin's resources in memory, answering each method in the shapes the stored
 * resources answer: a list filters by equal fields, sorts by one field and pages.
 */
export class MemoryInstanceAdminRepository extends InstanceAdminRepository {
  static create({ store }: { store: MemoryOpsStore }): MemoryInstanceAdminRepository {
    return new MemoryInstanceAdminRepository(store);
  }

  private constructor(private readonly store: MemoryOpsStore) {
    super();
  }

  async execute({ resource, method, params }: AdminOperationInput): Promise<AdminOperationResult> {
    const rows = this.rowsOf(resource);
    const id = params.id === undefined ? "" : String(params.id);
    const ids = Array.isArray(params.ids) ? params.ids.map(String) : [];
    switch (method) {
      case "getList":
        return page({ rows: [...rows.values()], params, filter: params.filter ?? {} });
      case "getOne":
        return { data: rows.get(id) ?? null };
      case "getMany":
        return { data: ids.flatMap((each) => rows.get(each) ?? []) };
      case "getManyReference":
        return page({
          rows: [...rows.values()],
          params,
          filter: { ...params.filter, [String(params.target)]: params.id },
        });
      case "create": {
        const given = params.data?.id;
        const row = {
          ...params.data,
          id:
            typeof given === "string" || typeof given === "number"
              ? String(given)
              : generate(resource).toString(),
        };
        this.refuseSecondLivePlan({ resource, rows, written: [row] });
        rows.set(row.id, row);
        return { data: row };
      }
      case "update":
        this.refuseSecondLivePlan({
          resource,
          rows,
          written: this.merged({ rows, ids: [id], data: params.data }),
        });
        return { data: this.merge({ rows, id, data: params.data }) };
      case "updateMany":
        this.refuseSecondLivePlan({
          resource,
          rows,
          written: this.merged({ rows, ids, data: params.data }),
        });
        for (const each of ids) this.merge({ rows, id: each, data: params.data });
        return { data: ids };
      case "delete": {
        const row = rows.get(id) ?? null;
        rows.delete(id);
        return { data: row };
      }
      case "deleteMany":
        for (const each of ids) rows.delete(each);
        return { data: ids };
    }
  }

  async findActiveSubscriptionIds({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<string[]> {
    return [...this.rowsOf("subscription").values()]
      .filter((row) => row.organizationId === organizationId && row.status === "ACTIVE")
      .map((row) => String(row.id));
  }

  async findSubscriptionStates({
    ids,
  }: {
    ids: string[];
  }): Promise<{ id: string; organizationId: string; status: string }[]> {
    const rows = this.rowsOf("subscription");
    return ids.flatMap((id) => {
      const row = rows.get(id);
      return row
        ? [{ id, organizationId: String(row.organizationId), status: String(row.status) }]
        : [];
    });
  }

  async findUserById(id: string): Promise<AdminDataResult> {
    return { data: this.rowsOf("user").get(id) ?? null };
  }

  private rowsOf(resource: AdminOperationInput["resource"]): Map<string, AdminRow> {
    const existing = this.store.adminRows.get(resource);
    if (existing) return existing;
    const rows = new Map<string, AdminRow>();
    this.store.adminRows.set(resource, rows);
    return rows;
  }

  /** The rows a write would leave, unwritten. */
  private merged({
    rows,
    ids,
    data,
  }: {
    rows: Map<string, AdminRow>;
    ids: string[];
    data: AdminOperationParams["data"];
  }): AdminRow[] {
    return ids.flatMap((id) => {
      const existing = rows.get(id);
      return existing ? [{ ...existing, ...data, id }] : [];
    });
  }

  /** The one-live-plan index the Prisma twin's table holds, refused before anything is written. */
  private refuseSecondLivePlan({
    resource,
    rows,
    written,
  }: {
    resource: AdminOperationInput["resource"];
    rows: Map<string, AdminRow>;
    written: AdminRow[];
  }): void {
    if (resource !== "subscription") return;
    const writtenIds = new Set(written.map((row) => String(row.id)));
    const slots = [
      ...[...rows.values()].filter((row) => !writtenIds.has(String(row.id))),
      ...written,
    ].filter(holdsLivePlanSlot);
    for (const row of written.filter(holdsLivePlanSlot)) {
      const organizationId = String(row.organizationId);
      const holders = slots.filter((each) => each.organizationId === row.organizationId);
      if (holders.length < 2) continue;
      throw new AdminSubscriptionAlreadyActiveError({
        organizationId,
        activeSubscriptionIds: holders
          .map((each) => String(each.id))
          .filter((id) => !writtenIds.has(id)),
      });
    }
  }

  private merge({
    rows,
    id,
    data,
  }: {
    rows: Map<string, AdminRow>;
    id: string;
    data: AdminOperationParams["data"];
  }): AdminRow | null {
    const existing = rows.get(id);
    if (!existing) return null;
    const row = { ...existing, ...data, id };
    rows.set(id, row);
    return row;
  }
}

function page({
  rows,
  params,
  filter,
}: {
  rows: AdminRow[];
  params: AdminOperationParams;
  filter: Record<string, unknown>;
}): AdminListResult {
  const field = params.sort?.field ?? "id";
  const direction = params.sort?.order === "DESC" ? -1 : 1;
  const perPage = params.pagination?.perPage ?? 25;
  const start = ((params.pagination?.page ?? 1) - 1) * perPage;
  const matching = rows
    .filter((row) => Object.entries(filter).every(([key, value]) => row[key] === value))
    .toSorted((left, right) => direction * String(left[field]).localeCompare(String(right[field])));
  return { data: matching.slice(start, start + perPage), total: matching.length };
}
