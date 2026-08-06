/**
 * Data migration: fold Google Agent Platform provider rows into Gemini.
 *
 * Background:
 * - Agent Platform shipped briefly as its own provider
 *   (`google_agent_platform`), holding a key, project and location.
 * - It is actually Gemini's second door: same models, same wire shape,
 *   different host — so the provider folded into `gemini`, whose
 *   credential now optionally carries the project and location
 *   (specs/model-providers/google-agent-platform.feature).
 * - Rows stored under the old provider would otherwise be orphaned: the
 *   registry no longer knows `google_agent_platform`, so the UI hides
 *   them and nothing can dispatch them.
 *
 * The fold renames the credential fields and flips the provider column;
 * scope entries, enabled state and everything else on the row stay
 * untouched. Idempotent: reruns find no `google_agent_platform` rows.
 *
 * Usage:
 *   pnpm task migrateAgentPlatformToGemini
 */

import { prisma } from "../server/db";
import { decrypt, encrypt } from "../utils/encryption";

// ============================================================================
// Pure migration logic (no DB dependency)
// ============================================================================

/**
 * Field-name mapping from the retired provider's credential shape to
 * Gemini's. Values pass through untouched — only the names change.
 */
const KEY_RENAMES = {
  GOOGLE_AGENT_PLATFORM_API_KEY: "GEMINI_API_KEY",
  GOOGLE_AGENT_PLATFORM_PROJECT: "GEMINI_PROJECT",
  GOOGLE_AGENT_PLATFORM_LOCATION: "GEMINI_LOCATION",
} as const satisfies Record<string, string>;

/**
 * Rename an Agent Platform credential's fields to the Gemini names.
 *
 * Pure function, exported for the unit test binding the migration
 * scenario. Unknown fields pass through under their own names so a row
 * that somehow carries extras loses nothing.
 */
export function foldAgentPlatformKeys(
  customKeys: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(customKeys).map(([key, value]) => [
      KEY_RENAMES[key as keyof typeof KEY_RENAMES] ?? key,
      value,
    ]),
  );
}

/**
 * Fold a stored customKeys value into its re-encrypted Gemini shape.
 *
 * Handles both storage forms: the encrypted string blob (the norm — see
 * ModelProviderRepository.encryptCustomKeys) and a plain object (the
 * pre-encryption transition shape the repository's decrypt path still
 * tolerates). `null` means the row carries no credential — nothing to
 * fold. Anything else, or a blob that fails to decrypt or parse, throws:
 * the caller must skip the row rather than flip a provider whose
 * credential still wears the old field names.
 */
export function foldStoredCustomKeys(customKeys: unknown): string | null {
  if (customKeys === null || customKeys === undefined) return null;

  let decrypted: unknown;
  if (typeof customKeys === "string") {
    decrypted = JSON.parse(decrypt(customKeys));
  } else if (typeof customKeys === "object") {
    decrypted = customKeys;
  } else {
    throw new Error(`unexpected customKeys type: ${typeof customKeys}`);
  }

  if (!decrypted || typeof decrypted !== "object" || Array.isArray(decrypted)) {
    throw new Error("customKeys did not resolve to an object");
  }

  return encrypt(
    JSON.stringify(foldAgentPlatformKeys(decrypted as Record<string, unknown>)),
  );
}

/**
 * The display name the folded row should carry. A row still wearing the
 * retired provider's default name becomes "Gemini" (suffixed if the
 * organization already has one, matching the create-time convention);
 * a customer-renamed row keeps its name.
 */
export function foldedRowName({
  currentName,
  takenNames,
}: {
  currentName: string;
  takenNames: string[];
}): string {
  if (currentName !== "Google Agent Platform") return currentName;
  if (!takenNames.includes("Gemini")) return "Gemini";
  let suffix = 2;
  while (takenNames.includes(`Gemini ${suffix}`)) suffix += 1;
  return `Gemini ${suffix}`;
}

// ============================================================================
// Task entry point
// ============================================================================

/**
 * How many organizations one page of the walk loads. The scan is one query
 * per organization — `ModelProvider`'s tenancy guard takes `organizationId`
 * as a string only, never an `in` list — so the page bounds how many rows
 * are ever held at once, and the concurrency below bounds how many of those
 * queries are in flight against the connection pool.
 */
const ORG_PAGE_SIZE = 200;
const SCAN_CONCURRENCY = 5;

/** Run `worker` over `items`, at most `limit` in flight. */
async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, () =>
    (async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await worker(items[index]!);
      }
    })(),
  );
  await Promise.all(runners);
  return results;
}

type FoldableRow = {
  id: string;
  name: string;
  organizationId: string;
  customKeys: unknown;
};

/** Fold one row, returning its id when it had to be skipped. */
async function foldRow(row: FoldableRow): Promise<string | null> {
  // The credential folds first, and a row whose credential cannot be
  // folded is skipped entirely: flipping its provider while the blob
  // still wears the old field names would present a Gemini row that
  // dispatches nothing, and the rerun could never find it again. A bad
  // row costs itself, not the rows after it.
  let foldedKeys: string | null;
  try {
    foldedKeys = foldStoredCustomKeys(row.customKeys);
  } catch (error) {
    console.error(
      `Skipping row ${row.id}: credential could not be folded (${String(error)})`,
    );
    return row.id;
  }

  const siblings = await prisma.modelProvider.findMany({
    where: {
      organizationId: row.organizationId,
      provider: "gemini",
    },
    select: { name: true },
  });

  await prisma.modelProvider.update({
    where: { id: row.id },
    data: {
      provider: "gemini",
      name: foldedRowName({
        currentName: row.name,
        takenNames: siblings.map((s) => s.name),
      }),
      ...(foldedKeys === null ? {} : { customKeys: foldedKeys }),
    },
  });

  console.log(`Folded row ${row.id} into gemini`);
  return null;
}

/** Every organization, in id order, one bounded page at a time. */
async function* organizationPages(): AsyncGenerator<{ id: string }[]> {
  let cursor: string | undefined;
  for (;;) {
    const page = await prisma.organization.findMany({
      select: { id: true },
      orderBy: { id: "asc" },
      take: ORG_PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (page.length === 0) return;
    yield page;
    if (page.length < ORG_PAGE_SIZE) return;
    cursor = page[page.length - 1]!.id;
  }
}

/** The legacy rows owned by one page of organizations. */
async function scanPage(
  organizations: { id: string }[],
): Promise<FoldableRow[]> {
  const perOrganization = await mapWithLimit(
    organizations,
    SCAN_CONCURRENCY,
    (org) =>
      prisma.modelProvider.findMany({
        where: {
          organizationId: org.id,
          provider: "google_agent_platform",
        },
        select: {
          id: true,
          name: true,
          organizationId: true,
          customKeys: true,
        },
      }),
  );
  return perOrganization.flat();
}

export default async function execute() {
  // ModelProvider is a tenancy-scoped model: the multitenancy middleware
  // rejects a where-clause carrying neither a row id, an organizationId,
  // nor a scope predicate (utils/dbMultiTenancyProtection.ts), so a bare
  // `{ provider }` scan throws before it reads a row. Walking
  // organizations satisfies the guard with the ADR-021 single-org anchor
  // every row carries — and unlike a per-project walk it also reaches
  // rows granted at ORG and TEAM scope.
  //
  // The walk is paged and each page folds before the next loads, so an
  // installation with many organizations neither opens a connection per
  // organization at once nor holds every matching row in memory.
  const skipped: string[] = [];
  let folded = 0;

  for await (const organizations of organizationPages()) {
    for (const row of await scanPage(organizations)) {
      const skippedId = await foldRow(row);
      if (skippedId) {
        skipped.push(skippedId);
      } else {
        folded += 1;
      }
    }
  }

  console.log(`Folded ${folded} google_agent_platform row(s) into gemini`);

  // A skipped row means the fold is NOT done: fail the task so automation
  // cannot read "some rows remain unusable" as a successful migration.
  // Thrown after the walk so every foldable row was still folded first.
  if (skipped.length > 0) {
    throw new Error(
      `${skipped.length} row(s) skipped and still google_agent_platform: ${skipped.join(", ")} — fix their customKeys and rerun.`,
    );
  }
  console.log("Done");
}
