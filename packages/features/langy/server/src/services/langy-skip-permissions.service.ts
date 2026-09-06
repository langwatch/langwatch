/**
 * Whether the model behind a Langy conversation may skip permission checks on
 * the developer's machine (ADR-129). Server owns this; the command line keeps
 * its own path guard and allowlist regardless.
 */
import {
  matchesSkipList,
  modelProviders,
  parseModelProviderWireValue,
  readStoredSkipList,
  resolveSkipList,
} from "@langwatch/model-provider-contract";

/**
 * The row fields the gate reads. Narrow on purpose: the gate never needs a
 * credential, so a caller can hand it a plain list in a test without building
 * a whole provider row.
 */
export interface SkipPermissionsProviderRow {
  id: string;
  provider: string;
  routingHandle: string | null;
  createdAt: Date;
  langySkipPermissionsModels: unknown;
}

/** What the gate loads its rows from. */
export interface SkipPermissionsProviderRows {
  findAllAccessibleForProject(projectId: string): Promise<SkipPermissionsProviderRow[]>;
}

export interface SkipPermissionsDecision {
  allowed: boolean;
  /** The provider family behind the model, empty when nothing resolved. */
  provider: string;
  /** The model id without its prefix. */
  modelId: string;
}

/**
 * Splits a conversation's model reference into provider family and bare model
 * id. A stored row id or routing handle names ONE row; a provider family
 * ("anthropic/claude-fable-5-1") names a kind that every row of it answers to.
 */
function splitModelReference({
  model,
  rows,
}: {
  model: string;
  rows: SkipPermissionsProviderRow[];
}): {
  provider: string;
  modelId: string;
  row: SkipPermissionsProviderRow | null;
} {
  const parsed = parseModelProviderWireValue(model);
  if (parsed.kind === "unknown") {
    return { provider: "", modelId: parsed.raw, row: null };
  }

  if (parsed.kind === "mp-id") {
    const row = rows.find((candidate) => candidate.id === parsed.mpId) ?? null;

    return { provider: row?.provider ?? "", modelId: parsed.model, row };
  }

  if (parsed.provider in modelProviders) {
    return { provider: parsed.provider, modelId: parsed.model, row: null };
  }

  const row = rows.find((candidate) => candidate.routingHandle === parsed.provider) ?? null;

  return { provider: row?.provider ?? "", modelId: parsed.model, row };
}

/**
 * The list that decides for a provider family when no single row was named.
 * A stored list wins over the registry default; the oldest row wins ties, to
 * keep the answer stable across calls regardless of query order.
 */
function listForFamily({
  provider,
  rows,
}: {
  provider: string;
  rows: SkipPermissionsProviderRow[];
}): readonly string[] {
  const withStoredList = rows
    .filter((row) => row.provider === provider)
    .filter((row) => readStoredSkipList(row.langySkipPermissionsModels).length > 0)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  return resolveSkipList({
    provider,
    stored: withStoredList[0]?.langySkipPermissionsModels ?? null,
  });
}

export class SkipPermissionsService {
  private constructor() {}

  static create(): SkipPermissionsService {
    return new SkipPermissionsService();
  }

  /**
   * Answers whether `model` may run with permission checks skipped. `model`
   * may be "openai/gpt-6", "mp_abc123/gpt-6", or a routing handle.
   */
  static async canModelSkipPermissions({
    projectId,
    model,
    providerRows,
  }: {
    projectId: string;
    model: string;
    /** The accessible provider rows. Supplied by the composition root (ADR-092 layering). */
    providerRows: SkipPermissionsProviderRows;
  }): Promise<SkipPermissionsDecision> {
    const rows = await providerRows.findAllAccessibleForProject(projectId);
    const { provider, modelId, row } = splitModelReference({ model, rows });

    if (provider === "" || modelId === "") {
      return { allowed: false, provider, modelId };
    }

    const patterns = row
      ? resolveSkipList({ provider, stored: row.langySkipPermissionsModels })
      : listForFamily({ provider, rows });

    return {
      allowed: matchesSkipList({ patterns, modelId }),
      provider,
      modelId,
    };
  }
}
