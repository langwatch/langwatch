import { HandledError } from "@langwatch/handled-error";
import { z } from "zod";

import type { ContractArchiveRepository } from "./contract-archive.repository.ts";

/** Postgres keeps 63 bytes of a name and silently cuts the rest. */
const POSTGRES_NAME_BYTES = 63;
const TABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const contractArchiveEntrySchema = z.object({
  step: z.string(),
  table: z.string(),
  archive: z.string(),
  /** copied: copied and checked now; archived: an earlier run did; absent: nothing to keep. */
  state: z.enum(["copied", "archived", "absent", "would-copy", "would-fail"]),
  rows: z.number().nullable(),
  reason: z.string().nullable(),
});
export type ContractArchiveEntry = z.infer<typeof contractArchiveEntrySchema>;

/** A contract step whose archive could not be made and checked: the drop must not run. */
export class ContractArchiveError extends HandledError {
  declare readonly code: "contract_archive_failed";

  constructor({ step, table, reason }: { step: string; table: string; reason: string }) {
    super("contract_archive_failed", `contract step ${step} cannot archive ${table}: ${reason}`, {
      httpStatus: 500,
    });
    this.name = "ContractArchiveError";
  }
}

export type ContractArchiveStore = Pick<ContractArchiveRepository, "counts" | "copy">;

/** `_retired_<table>_<release>`, the release's dots as underscores. */
export const archiveNameOf = ({ table, release }: { table: string; release: string | null }) =>
  `_retired_${table}_${(release ?? "unreleased").replaceAll(/[^A-Za-z0-9]/g, "_")}`;

/**
 * Archive-or-fail (Alex, 2026-10-09): copies each table a contract retires into its `_retired_`
 * table and checks the copy holds the source's rows, or throws so the drop never runs.
 */
export class ContractArchiveService {
  static create({ store }: { store: ContractArchiveStore }): ContractArchiveService {
    return new ContractArchiveService(store);
  }

  private constructor(private readonly store: ContractArchiveStore) {}

  async archive({
    step,
    tables,
    release,
    dryRun = false,
  }: {
    step: string;
    tables: readonly string[];
    release: string | null;
    dryRun?: boolean;
  }): Promise<ContractArchiveEntry[]> {
    const entries: ContractArchiveEntry[] = [];
    for (const table of tables) {
      const archive = archiveNameOf({ table, release });
      const entry = { step, table, archive };
      const refused = refusalOf({ step, table, archive });
      if (refused !== null && dryRun) {
        entries.push({ ...entry, state: "would-fail", rows: null, reason: refused });
        continue;
      }
      if (refused !== null) throw new ContractArchiveError({ step, table, reason: refused });
      entries.push({ ...entry, ...(await this.archiveOne({ step, table, archive, dryRun })) });
    }
    return entries;
  }

  private async archiveOne({
    step,
    table,
    archive,
    dryRun,
  }: {
    step: string;
    table: string;
    archive: string;
    dryRun: boolean;
  }): Promise<Pick<ContractArchiveEntry, "state" | "rows" | "reason">> {
    const before = await this.store.counts({ source: table, archive });
    if (before.source === null) {
      const state = before.archive === null ? "absent" : "archived";
      return { state, rows: before.archive, reason: null };
    }
    // ponytail: a row count checks the copy; a content hash if a retired table may still change.
    if (before.archive === before.source)
      return { state: "archived", rows: before.source, reason: null };
    if (dryRun) return { state: "would-copy", rows: before.source, reason: null };
    await this.store.copy({ source: table, archive });
    const after = await this.store.counts({ source: table, archive });
    if (after.source !== after.archive) {
      throw new ContractArchiveError({
        step,
        table,
        reason: `${archive} holds ${after.archive ?? "no"} rows, ${table} holds ${after.source ?? "no"}; is something still writing it?`,
      });
    }
    return { state: "copied", rows: after.archive, reason: null };
  }
}

function refusalOf({
  step,
  table,
  archive,
}: {
  step: string;
  table: string;
  archive: string;
}): string | null {
  if (!step.startsWith("prisma:")) return "only Postgres contract steps can archive so far";
  if (!TABLE_NAME.test(table)) return "the archive note must name one unquoted table";
  if (Buffer.byteLength(archive) > POSTGRES_NAME_BYTES)
    return `${archive} is longer than the ${POSTGRES_NAME_BYTES} bytes Postgres keeps`;
  return null;
}
