// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  AiToolEntry,
  AiToolStarterTile,
  AiToolType,
  CreateAiToolEntryInput,
  ReorderAiToolEntriesInput,
  SeedAiToolStarterPackInput,
  UpdateAiToolEntryInput,
} from "@langwatch/enterprise-governance-contract";
import { nowInstant } from "@langwatch/time";

import { AiToolCatalogRepository } from "../ai-tool-catalog.repository.ts";

/** The Prisma tier's twin: the same rows, ordering and starter-pack fingerprinting, in a list. */
export class MemoryAiToolCatalogRepository extends AiToolCatalogRepository {
  private readonly entries: AiToolEntry[] = [];
  private sequence = 0;

  private constructor() {
    super();
  }

  static create(): MemoryAiToolCatalogRepository {
    return new MemoryAiToolCatalogRepository();
  }

  async findEnabled(input: { organizationId: string; type?: AiToolType }): Promise<AiToolEntry[]> {
    return this.ordered(
      (entry) =>
        entry.organizationId === input.organizationId &&
        entry.enabled &&
        entry.archivedAtMs === null &&
        (!input.type || entry.type === input.type),
    );
  }

  async findAdmin(organizationId: string): Promise<AiToolEntry[]> {
    return this.ordered(
      (entry) => entry.organizationId === organizationId && entry.archivedAtMs === null,
    );
  }

  async findById(id: string): Promise<AiToolEntry | null> {
    return this.entries.find((entry) => entry.id === id) ?? null;
  }

  async create(input: { values: CreateAiToolEntryInput; slug: string }): Promise<AiToolEntry> {
    const { values } = input;
    return this.insert({
      organizationId: values.organizationId,
      ...legacyScope(values.organizationId, values.departmentIds),
      departmentIds: [...values.departmentIds],
      type: values.type,
      displayName: values.displayName,
      slug: input.slug,
      iconAsset: values.iconAsset ?? null,
      order: values.order ?? 0,
      config: values.config,
      actorUserId: values.actorUserId ?? null,
    });
  }

  async update(input: UpdateAiToolEntryInput): Promise<AiToolEntry> {
    const index = this.entries.findIndex((entry) => entry.id === input.id);
    const existing = this.entries[index];
    if (!existing) throw new Error(`No AI tool entry ${input.id}`);
    const next: AiToolEntry = {
      ...existing,
      ...(input.displayName !== undefined && { displayName: input.displayName }),
      ...(input.iconAsset !== undefined && { iconAsset: input.iconAsset }),
      ...(input.order !== undefined && { order: input.order }),
      ...(input.enabled !== undefined && { enabled: input.enabled }),
      ...(input.type !== undefined && { type: input.type }),
      ...(input.config !== undefined && { config: input.config }),
      ...(input.departmentIds !== undefined && {
        departmentIds: [...input.departmentIds],
        ...legacyScope(input.organizationId, input.departmentIds),
      }),
      updatedById: input.actorUserId ?? null,
      updatedAtMs: nowInstant().epochMilliseconds,
    };
    this.entries[index] = next;
    return next;
  }

  async remove(id: string): Promise<AiToolEntry> {
    const index = this.entries.findIndex((entry) => entry.id === id);
    const [removed] = this.entries.splice(index, 1);
    if (!removed || index < 0) throw new Error(`No AI tool entry ${id}`);
    return removed;
  }

  async ensureDefaultCatalog(input: {
    organizationId: string;
    tiles: readonly AiToolStarterTile[];
  }): Promise<{ hasSeeded: boolean; created: number }> {
    if (this.entries.some((entry) => entry.organizationId === input.organizationId)) {
      return { hasSeeded: false, created: 0 };
    }
    input.tiles.forEach((tile, order) =>
      this.insertStarter({ organizationId: input.organizationId, tile, order, actorUserId: null }),
    );
    return { hasSeeded: true, created: input.tiles.length };
  }

  async seedStarterPack(input: {
    values: SeedAiToolStarterPackInput;
    tiles: readonly AiToolStarterTile[];
  }): Promise<{ created: number; updated: number; skipped: number }> {
    const { organizationId, actorUserId = null } = input.values;
    const existing = this.entries.filter(
      (entry) =>
        entry.organizationId === organizationId &&
        entry.scope === "organization" &&
        entry.scopeId === organizationId,
    );
    const fingerprint = (type: string, name: string) => `${type}::${name.trim().toLowerCase()}`;
    const byFingerprint = new Map(
      existing.map((entry) => [fingerprint(entry.type, entry.displayName), entry]),
    );
    let created = 0;
    let updated = 0;
    let skipped = 0;
    for (const tile of input.tiles) {
      const match = byFingerprint.get(fingerprint(tile.type, tile.displayName));
      if (!match) {
        this.insertStarter({ organizationId, tile, order: existing.length + created, actorUserId });
        created += 1;
      } else if (match.iconAsset === null) {
        match.iconAsset = tile.iconAsset;
        match.updatedById = actorUserId;
        updated += 1;
      } else skipped += 1;
    }
    return { created, updated, skipped };
  }

  async reorder(input: ReorderAiToolEntriesInput): Promise<void> {
    for (const { id, order } of input.updates) {
      const entry = this.entries.find(
        (candidate) => candidate.id === id && candidate.organizationId === input.organizationId,
      );
      if (entry) entry.order = order;
    }
  }

  private ordered(keep: (entry: AiToolEntry) => boolean): AiToolEntry[] {
    return this.entries
      .filter(keep)
      .toSorted(
        (left, right) =>
          left.order - right.order || left.displayName.localeCompare(right.displayName),
      );
  }

  private insertStarter(input: {
    organizationId: string;
    tile: AiToolStarterTile;
    order: number;
    actorUserId: string | null;
  }): AiToolEntry {
    const { tile } = input;
    return this.insert({
      organizationId: input.organizationId,
      scope: "organization",
      scopeId: input.organizationId,
      departmentIds: [],
      type: tile.type,
      displayName: tile.displayName,
      slug: tile.slug,
      iconAsset: tile.iconAsset,
      order: input.order,
      config: { ...tile.config },
      actorUserId: input.actorUserId,
    });
  }

  private insert(
    values: Pick<
      AiToolEntry,
      | "organizationId"
      | "scope"
      | "scopeId"
      | "departmentIds"
      | "type"
      | "displayName"
      | "slug"
      | "iconAsset"
      | "order"
      | "config"
    > & { actorUserId: string | null },
  ): AiToolEntry {
    const { actorUserId, ...rest } = values;
    this.sequence += 1;
    const now = nowInstant().epochMilliseconds;
    const entry: AiToolEntry = {
      ...rest,
      id: `ai_tool_${this.sequence}`,
      iconKey: null,
      enabled: true,
      archivedAtMs: null,
      createdAtMs: now,
      updatedAtMs: now,
      createdById: actorUserId,
      updatedById: actorUserId,
    };
    this.entries.push(entry);
    return entry;
  }
}

function legacyScope(
  organizationId: string,
  departmentIds: readonly string[],
): { scope: "organization" | "department"; scopeId: string } {
  const [first] = departmentIds;
  return first
    ? { scope: "department", scopeId: first }
    : { scope: "organization", scopeId: organizationId };
}
