// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { GovernanceIngestionSource } from "@langwatch/enterprise-governance-contract";
import { Temporal, toDate } from "@langwatch/time";

import {
  IngestionSourceRepository,
  type CreateIngestionSourceRecord,
  type CursorPinnedUpdate,
  type IngestionSourceClaim,
  type UpdateIngestionSourceRecord,
} from "../ingestion-source.repository.ts";

type StoredSource = GovernanceIngestionSource & { providerAccountId: string | null };

/** The ingestion-source twin: one array standing in for the `IngestionSource` table. */
export class MemoryIngestionSourceRepository extends IngestionSourceRepository {
  private readonly rows: StoredSource[] = [];

  private constructor(private readonly now: () => number) {
    super();
  }

  static create(options: { now?: () => number } = {}): MemoryIngestionSourceRepository {
    return new MemoryIngestionSourceRepository(options.now ?? Date.now);
  }

  async findAll(organizationId: string): Promise<GovernanceIngestionSource[]> {
    return this.live(organizationId)
      .toSorted((a, b) => a.name.localeCompare(b.name))
      .map(toSource);
  }

  async findById(id: string): Promise<GovernanceIngestionSource | null> {
    const row = this.rows.find((candidate) => candidate.id === id);
    return row ? toSource(row) : null;
  }

  async findByCurrentSecretHash(hash: string): Promise<GovernanceIngestionSource | null> {
    const row = this.rows.find(
      (candidate) => candidate.archivedAt === null && candidate.ingestSecretHash === hash,
    );
    return row ? toSource(row) : null;
  }

  async findByPriorSecretHash(hash: string): Promise<GovernanceIngestionSource[]> {
    return this.rows
      .filter((row) => {
        const rotation = row.parserConfig._rotation;
        return (
          row.archivedAt === null &&
          rotation !== null &&
          typeof rotation === "object" &&
          "priorHash" in rotation &&
          rotation.priorHash === hash
        );
      })
      .map(toSource);
  }

  async countLive(organizationId: string): Promise<number> {
    return this.live(organizationId).length;
  }

  async findClaims(organizationId: string): Promise<IngestionSourceClaim[]> {
    return this.live(organizationId).map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      providerAccountId: row.providerAccountId,
      parserConfig: row.parserConfig,
    }));
  }

  async findAzureBillHistory(
    organizationId: string,
  ): Promise<{ id: string; parserConfig: unknown }[]> {
    return this.rows
      .filter(
        (row) =>
          row.organizationId === organizationId && row.sourceType === "copilot_studio_dataverse",
      )
      .map((row) => ({ id: row.id, parserConfig: row.parserConfig }));
  }

  async create(input: CreateIngestionSourceRecord): Promise<GovernanceIngestionSource> {
    const at = toDate(Temporal.Instant.fromEpochMilliseconds(this.now()));
    const row: StoredSource = {
      ...input,
      id: `source-${this.rows.length + 1}`,
      pollerCursor: null,
      errorCount: 0,
      lastEventAt: null,
      archivedAt: null,
      createdAt: at,
      updatedAt: at,
    };
    this.rows.push(row);
    return toSource(row);
  }

  async update(id: string, input: UpdateIngestionSourceRecord): Promise<GovernanceIngestionSource> {
    const index = this.rows.findIndex((row) => row.id === id);
    const current = this.rows[index];
    if (current === undefined) {
      throw new Error(`no ingestion source ${id}`);
    }
    const { archivedAt, lastEventAt, ...rest } = input;
    const next: StoredSource = {
      ...current,
      ...rest,
      ...(archivedAt === undefined ? {} : { archivedAt: toDate(archivedAt) }),
      ...(lastEventAt === undefined ? {} : { lastEventAt: toDate(lastEventAt) }),
      updatedAt: toDate(Temporal.Instant.fromEpochMilliseconds(this.now())),
    };
    this.rows[index] = next;
    return toSource(next);
  }

  async updateIfCursorUnchanged(input: {
    id: string;
    cursor: unknown;
    update: UpdateIngestionSourceRecord;
  }): Promise<CursorPinnedUpdate> {
    const row = this.rows.find((candidate) => candidate.id === input.id);
    if (row === undefined || JSON.stringify(row.pollerCursor) !== JSON.stringify(input.cursor)) {
      return { outcome: "cursor_moved" };
    }
    return { outcome: "updated", source: await this.update(input.id, input.update) };
  }

  private live(organizationId: string): StoredSource[] {
    return this.rows.filter(
      (row) => row.organizationId === organizationId && row.archivedAt === null,
    );
  }
}

function toSource({
  providerAccountId: _account,
  ...source
}: StoredSource): GovernanceIngestionSource {
  return source;
}
