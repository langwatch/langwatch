/**
 * Whether the model behind a Langy conversation may skip the permission
 * checks on the developer's machine (ADR-129).
 *
 * The server owns this answer. The command line keeps the path guard and the
 * allowlist whatever the server says, so this gate only ever decides whether
 * the toggle is offered at all.
 */
import type { PrismaClient } from "~/generated/prisma/client";
import { prisma as defaultPrisma } from "~/server/db";
import {
  matchesSkipList,
  readStoredSkipList,
  resolveSkipList,
} from "~/server/modelProviders/langySkipPermissions";
import { ModelProviderRepository } from "~/server/modelProviders/modelProvider.repository";
import { modelProviders } from "~/server/modelProviders/registry";
import { parseWireValue } from "~/server/modelProviders/wireFormat";

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
  findAllAccessibleForProject(
    projectId: string,
  ): Promise<SkipPermissionsProviderRow[]>;
}

export interface SkipPermissionsDecision {
  allowed: boolean;
  /** The provider family behind the model, empty when nothing resolved. */
  provider: string;
  /** The model id without its prefix. */
  modelId: string;
}

/**
 * Splits a conversation's model reference into the provider family and the
 * bare model id.
 *
 * Three prefixes reach here. A stored row id ("mp_abc/gpt-6") and a routing
 * handle ("eu/claude-sonnet-5") both name ONE row, so they resolve through the
 * accessible rows. A provider family ("anthropic/claude-fable-5-1") names a
 * kind, and every row of that kind answers to it.
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
  const parsed = parseWireValue(model);
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
  const row =
    rows.find((candidate) => candidate.routingHandle === parsed.provider) ??
    null;
  return { provider: row?.provider ?? "", modelId: parsed.model, row };
}

/**
 * The list that decides for a provider family when no single row was named.
 *
 * A stored list is an operator's explicit decision, so it wins over the
 * registry default. When several rows of the same family carry one, the oldest
 * decides, which keeps the answer the same on every call rather than following
 * whatever order the database returned.
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
    .filter(
      (row) => readStoredSkipList(row.langySkipPermissionsModels).length > 0,
    )
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return resolveSkipList({
    provider,
    stored: withStoredList[0]?.langySkipPermissionsModels ?? null,
  });
}

/**
 * Answers whether `model` may run with the permission checks skipped.
 *
 * `model` is the conversation's model reference in any of the shapes the
 * platform stores it in: "openai/gpt-6", "mp_abc123/gpt-6", or a routing
 * handle such as "eu/claude-sonnet-5".
 */
export async function canModelSkipPermissions({
  projectId,
  model,
  prisma,
  providerRows,
}: {
  projectId: string;
  model: string;
  prisma?: PrismaClient;
  providerRows?: SkipPermissionsProviderRows;
}): Promise<SkipPermissionsDecision> {
  const source =
    providerRows ?? new ModelProviderRepository(prisma ?? defaultPrisma);
  const rows = await source.findAllAccessibleForProject(projectId);
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
