import type { ArchitectureViolation } from "../../types.ts";
import type { WorkspaceSnapshot } from "../../workspace/snapshot.ts";
import {
  collectContractExports,
  collectForeignImports,
  type ForeignContractImport,
  hasTag,
} from "./contract-export-use.ts";

/**
 * Rule 12b (ADR-182): an `@ownerOnly` contract export is the owner's own vocabulary (a query
 * parameter name, a deep-link key), published only because its process and browser halves sit in
 * different packages. Another module importing it hard-codes the owner's address. Zero on main.
 */

export const OWNER_ONLY_CONSTANT_POLICY = "owner-only-constant";

export function collectOwnerOnlyImports(snapshot: WorkspaceSnapshot): ForeignContractImport[] {
  const exports = collectContractExports({
    snapshot,
    accept: (candidate) => hasTag({ comment: candidate.comment, tag: "ownerOnly" }),
  });

  return collectForeignImports({ snapshot, exports });
}

export function lintOwnerOnlyConstants(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  return collectOwnerOnlyImports(snapshot).map((finding) => ({
    policy: OWNER_ONLY_CONSTANT_POLICY,
    file: finding.file,
    line: finding.line,
    specifier: finding.export.name,
    message: `${finding.export.name} is tagged @ownerOnly in ${finding.export.file}; ${finding.importer} is not part of ${finding.export.module}, and importing it spells the owner's address by hand.`,
    allowed: `Ask ${finding.export.module} for an action or a link builder through its Api, or drop the import. See dev/docs/plans/platform-architecture-blocks.md rule 12b.`,
  }));
}
