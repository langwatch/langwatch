/**
 * The OpenAPI document's checker.
 *
 * It generates into a scratch file and compares that description against the
 * frozen `apps/api/src/features/discovery/openapi-document.json`. It NEVER
 * writes the frozen file — not as a fallback, not with a flag. Three routes
 * serve that artifact and both SDKs generate clients from it, so a checker
 * that could rewrite it would be a generator with a confusing name.
 *
 * The two directions of drift are not symmetrical, which is why they are
 * reported apart:
 *
 *   REMOVED — the document lists an operation no installed declaration
 *     publishes. Breaking. An integrator generated a client from it, and the
 *     call now 404s. This is the direction that fails a run.
 *
 *   ADDED — a declaration publishes an operation the document does not list.
 *     Not breaking, and unavoidable while the document is frozen: every route
 *     added since the freeze lands here. Reported so the size of the gap is
 *     visible, never failed on.
 *
 *   CHANGED — the operation is in both and its security requirement moved.
 *     Reported. Security is the one field the generator computes rather than
 *     copies, so a change here is a fact about enforcement, not about prose.
 *
 * See `specs/api/openapi-document.feature`.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import type { DeclaredRestFamily } from "./openapi-document.declarations.ts";
import {
  generateOpenApiDocument,
  operationKeysOf,
  type OpenApiDocument,
  type UndescribedRoute,
} from "./openapi-document.generator.ts";

/** One operation whose published security requirement moved. */
export type ChangedOperation = Readonly<{
  operation: string;
  documented: string;
  served: string;
}>;

/** What one check run found. */
export type OpenApiDriftReport = Readonly<{
  /** Where the freshly generated description was written. */
  scratchPath: string;
  /** The frozen document that was compared against. */
  frozenPath: string;
  /** How many operations each side describes. */
  counts: Readonly<{ served: number; documented: number }>;
  /** Documented and published by no declaration. The breaking direction. */
  removed: readonly string[];
  /**
   * Documented, still declared, and kept out of the generated document by its
   * own declaration — so the frozen document describes it by hand.
   *
   * Not drift. Reported apart from `removed` because the two look identical in
   * a document diff and mean opposite things: this is a route that answers.
   */
  undescribed: readonly string[];
  /** Declared and not documented. Reported only. */
  added: readonly string[];
  /** In both, with a different security requirement. Reported only. */
  changed: readonly ChangedOperation[];
  /**
   * Removed operations that are ALREADY missing at the baseline, and so are
   * inherited rather than caused by the change under test.
   */
  baselined: readonly string[];
  /** Removed operations outside the baseline. A non-empty list fails the run. */
  regressions: readonly string[];
  /** Declared operations no security scheme can express, so left undocumented. */
  unpublishable: readonly UndescribedRoute[];
}>;

/**
 * Operations the frozen document lists that no installed declaration publishes
 * TODAY, before any change under test.
 *
 * This is a debt list, not an allow-list. Every entry is a route an integrator
 * can generate a client for and then get a 404 from. The checker fails on any
 * removal OUTSIDE this list, so the list is what keeps the guard from being
 * red on arrival while still biting the next removal.
 *
 * SHRINK IT; NEVER ADD TO IT. An entry leaves when the module that publishes
 * the family is installed again, or when the operation is deliberately dropped
 * from the document.
 */
export const UNSERVED_AT_BASELINE: readonly string[] = [];

/** The frozen artifact, relative to this file. */
export const FROZEN_DOCUMENT_PATH = fileURLToPath(
  new URL("../../features/discovery/openapi-document.json", import.meta.url),
);

/**
 * Generates into `scratchPath` and reports the drift against the frozen
 * document.
 *
 * Nothing is written anywhere else. The frozen path is opened for READING
 * only, and the scratch path is the caller's — a check that has to write
 * somewhere writes there.
 */
export async function checkOpenApiDocument({
  scratchPath,
  families,
  frozenPath = FROZEN_DOCUMENT_PATH,
  baseline = UNSERVED_AT_BASELINE,
}: {
  scratchPath: string;
  /** The families to describe, as the task read them off this build. */
  families: readonly DeclaredRestFamily[];
  frozenPath?: string;
  baseline?: readonly string[];
}): Promise<OpenApiDriftReport> {
  const generated = await generateOpenApiDocument({ outputPath: scratchPath, families });
  const frozen = JSON.parse(await readFile(frozenPath, "utf8")) as OpenApiDocument;

  const served = new Set(generated.operations);
  const documented = new Set(operationKeysOf(frozen));
  const declares = routeMatcher(generated.declaredRoutes);

  const missing = [...documented].filter((operation) => !served.has(operation)).sort();
  const undescribed = missing.filter(declares);
  const removed = missing.filter((operation) => !declares(operation));
  const added = [...served].filter((operation) => !documented.has(operation)).sort();
  const inBaseline = new Set(baseline);

  return {
    scratchPath,
    frozenPath,
    counts: { served: served.size, documented: documented.size },
    removed,
    undescribed,
    added,
    changed: changedSecurity({ frozen, served: generated.document }),
    baselined: removed.filter((operation) => inBaseline.has(operation)),
    regressions: removed.filter((operation) => !inBaseline.has(operation)),
    unpublishable: generated.unpublishable,
  };
}

/**
 * Whether some declaration still publishes an address answering an operation.
 *
 * `ALL` is matched as well as the verb: a family declaring an any-method route
 * answers every method on that path, and treating one of those as unserved
 * would report a live route as a deletion.
 */
function routeMatcher(declaredRoutes: readonly string[]): (operation: string) => boolean {
  const routes = new Set(declaredRoutes);

  return (operation: string) => {
    const separator = operation.indexOf(" ");
    const path = operation.slice(separator + 1);

    return routes.has(operation) || routes.has(`ALL ${path}`);
  };
}

/**
 * Operations present on both sides whose security requirement moved.
 *
 * Only `security` is compared. Everything else in an operation is prose,
 * examples and schemas that move whenever a description is edited, and a diff
 * over all of it would report every wording change as drift. The security
 * requirement is the one field the generator DERIVES — from the declaration's
 * own credential — so a change there says the enforcement changed, which is
 * the kind of drift worth a line of output.
 */
function changedSecurity({
  frozen,
  served,
}: {
  frozen: OpenApiDocument;
  served: OpenApiDocument;
}): ChangedOperation[] {
  const changed: ChangedOperation[] = [];
  const servedSecurity = securityByOperation(served);

  for (const [operation, documentedRequirement] of securityByOperation(frozen)) {
    const servedRequirement = servedSecurity.get(operation);

    if (servedRequirement === undefined) continue;

    if (servedRequirement === documentedRequirement) continue;

    changed.push({ operation, documented: documentedRequirement, served: servedRequirement });
  }

  return changed.sort((left, right) => left.operation.localeCompare(right.operation));
}

/** `METHOD /path` to its security requirement, serialised for comparison. */
function securityByOperation(document: OpenApiDocument): Map<string, string> {
  const byOperation = new Map<string, string>();

  for (const [routePath, item] of Object.entries(document.paths ?? {})) {
    for (const [method, operation] of Object.entries(item)) {
      if (!operation || typeof operation !== "object") continue;

      const security = (operation as { security?: unknown }).security;

      byOperation.set(
        `${method.toUpperCase()} ${routePath}`,
        JSON.stringify(security ?? "(document default)"),
      );
    }
  }

  return byOperation;
}

/** The report as the lines a person reads in a terminal or a CI log. */
export function renderDriftReport(report: OpenApiDriftReport): string {
  const lines = [
    `Wrote the declared description to ${report.scratchPath}`,
    `Compared against the frozen document at ${report.frozenPath}`,
    "",
    `declared:   ${report.counts.served} operations`,
    `documented: ${report.counts.documented} operations`,
    "",
    `removed:     ${report.removed.length} (${report.regressions.length} outside the baseline)`,
    `undescribed: ${report.undescribed.length} (declared, described by hand in the frozen document)`,
    `added:       ${report.added.length}`,
    `changed:     ${report.changed.length}`,
  ];

  if (report.regressions.length > 0) {
    lines.push("", "Documented operations no installed declaration publishes:");
    for (const operation of report.regressions) lines.push(`  - ${operation}`);
  }

  if (report.undescribed.length > 0) {
    lines.push("", "Documented by hand, still declared, and hidden by their own declaration:");
    for (const operation of report.undescribed) lines.push(`  = ${operation}`);
  }

  if (report.added.length > 0) {
    lines.push("", "Declared and undocumented (reported, not failed — the document is frozen):");
    for (const operation of report.added) lines.push(`  + ${operation}`);
  }

  if (report.changed.length > 0) {
    lines.push("", "Security requirement changed:");
    for (const { operation, documented, served } of report.changed) {
      lines.push(`  ~ ${operation}: ${documented} -> ${served}`);
    }
  }

  if (report.unpublishable.length > 0) {
    lines.push("", "Declared, and left out because no scheme can express the credential:");
    for (const { operation, because } of report.unpublishable) {
      lines.push(`  ! ${operation}`, `      ${because}`);
    }
  }

  return lines.join("\n");
}
