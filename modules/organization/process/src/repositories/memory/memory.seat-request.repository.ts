import { SeatRequestNotFoundError } from "@langwatch/organization-contract";

import type {
  SeatRequestOpened,
  SeatRequestRepository,
  SeatRequestRow,
} from "../seat-request.repository.ts";

/** Seat requests held in-process, with the same reuse-the-row rules as Postgres. */
export class MemorySeatRequestRepository implements SeatRequestRepository {
  static create(): MemorySeatRequestRepository {
    return new MemorySeatRequestRepository();
  }

  readonly rows: SeatRequestRow[] = [];
  /** Each approval still giving its seat, by request id: when it claimed the request. */
  readonly seatPendingSince = new Map<string, number>();

  private constructor() {}

  async open(input: Parameters<SeatRequestRepository["open"]>[0]): Promise<SeatRequestOpened> {
    const index = this.rows.findIndex(
      (row) => row.organizationId === input.organizationId && row.email === input.email,
    );
    const existing = this.rows[index];
    if (existing && input.onlyIfAbsent) return { request: existing, outcome: "already_recorded" };
    if (!existing) {
      const request: SeatRequestRow = {
        id: input.id,
        organizationId: input.organizationId,
        email: input.email,
        userId: input.userId,
        name: input.name,
        status: "OPEN",
        source: input.source,
        idpRefused: input.idpRefused,
        idpKind: input.idpKind,
        salesNotifiedAt: null,
        openedAt: input.at,
        resolvedAt: null,
        resolvedByUserId: null,
      };
      this.rows.push(request);
      return { request, outcome: "opened" };
    }
    if (existing.status === "OPEN") {
      const request: SeatRequestRow = {
        ...existing,
        userId: existing.userId ?? input.userId,
        name: existing.name ?? input.name,
        idpRefused: existing.idpRefused || input.idpRefused,
        idpKind: input.idpKind ?? existing.idpKind,
      };
      this.rows[index] = request;
      return { request, outcome: "already_open" };
    }
    const request: SeatRequestRow = {
      ...existing,
      userId: input.userId ?? existing.userId,
      name: input.name ?? existing.name,
      status: "OPEN",
      source: input.source,
      idpRefused: input.idpRefused,
      idpKind: input.idpKind,
      openedAt: input.at,
      resolvedAt: null,
      resolvedByUserId: null,
      salesNotifiedAt: null,
    };
    this.rows[index] = request;
    this.seatPendingSince.delete(request.id);
    return { request, outcome: "reopened" };
  }

  async findOpen({ organizationId }: { organizationId: string }): Promise<SeatRequestRow[]> {
    return this.rows
      .filter((row) => row.organizationId === organizationId && row.status === "OPEN")
      .toSorted((a, b) => a.openedAt - b.openedAt);
  }

  async getOpen({
    organizationId,
    id,
  }: {
    organizationId: string;
    id: string;
  }): Promise<SeatRequestRow> {
    const row = this.rows.find(
      (candidate) =>
        candidate.id === id &&
        candidate.organizationId === organizationId &&
        candidate.status === "OPEN",
    );
    if (!row) throw new SeatRequestNotFoundError(id);
    return row;
  }

  async resolve(input: Parameters<SeatRequestRepository["resolve"]>[0]): Promise<boolean> {
    const index = this.rows.findIndex(
      (row) =>
        row.id === input.id && row.organizationId === input.organizationId && row.status === "OPEN",
    );
    const row = this.rows[index];
    if (!row) return false;
    this.rows[index] = {
      ...row,
      status: input.status,
      resolvedAt: input.at,
      resolvedByUserId: input.resolvedByUserId,
    };
    if (input.status === "APPROVED") this.seatPendingSince.set(row.id, input.at);
    return true;
  }

  async release(input: Parameters<SeatRequestRepository["release"]>[0]): Promise<void> {
    const index = this.rows.findIndex(
      (row) =>
        row.id === input.id &&
        row.organizationId === input.organizationId &&
        row.status === "APPROVED" &&
        row.resolvedAt === input.at &&
        row.resolvedByUserId === input.resolvedByUserId,
    );
    const row = this.rows[index];
    if (!row) return;
    this.rows[index] = { ...row, status: "OPEN", resolvedAt: null, resolvedByUserId: null };
    this.seatPendingSince.delete(row.id);
  }

  async settleSeat(input: Parameters<SeatRequestRepository["settleSeat"]>[0]): Promise<void> {
    const row = this.rows.find(
      (candidate) =>
        candidate.id === input.id &&
        candidate.organizationId === input.organizationId &&
        candidate.status === "APPROVED" &&
        candidate.resolvedAt === input.at,
    );
    if (row) this.seatPendingSince.delete(row.id);
  }

  async findSeatPending({
    organizationId,
    since,
  }: {
    organizationId: string;
    since: number;
  }): Promise<SeatRequestRow[]> {
    return this.rows.filter((row) => {
      const pending = this.seatPendingSince.get(row.id);
      return (
        row.organizationId === organizationId &&
        row.status === "APPROVED" &&
        pending !== undefined &&
        pending < since
      );
    });
  }

  async claimSalesNotice({ id, at }: { id: string; at: number }): Promise<boolean> {
    const index = this.rows.findIndex(
      (row) => row.id === id && row.status === "OPEN" && row.salesNotifiedAt === null,
    );
    const row = this.rows[index];
    if (!row) return false;
    this.rows[index] = { ...row, salesNotifiedAt: at };
    return true;
  }

  async findForUser({ userId }: { userId: string }): Promise<SeatRequestRow[]> {
    return this.rows.filter((row) => row.userId === userId);
  }
}
