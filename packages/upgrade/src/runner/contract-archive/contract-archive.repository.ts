import type { UpgradePostgres } from "../../ports.ts";

/** A table's row count, or null when the table does not exist. */
export type ArchiveCounts = { source: number | null; archive: number | null };

const quoted = (name: string) => `"${name}"`;

/** The Postgres tables a contract retires and their `_retired_` copies (Alex, 2026-10-09). */
export class ContractArchiveRepository {
  static create({ postgres }: { postgres: UpgradePostgres }): ContractArchiveRepository {
    return new ContractArchiveRepository(postgres);
  }

  private constructor(private readonly postgres: UpgradePostgres) {}

  /** Both counts read in one statement, so they share one snapshot. */
  async counts({ source, archive }: { source: string; archive: string }): Promise<ArchiveCounts> {
    const { rows: found } = await this.postgres.query<{ source: boolean; archive: boolean }>(
      `SELECT to_regclass($1) IS NOT NULL AS "source", to_regclass($2) IS NOT NULL AS "archive"`,
      [quoted(source), quoted(archive)],
    );
    const exists = found[0] ?? { source: false, archive: false };
    const count = (name: string, present: boolean) =>
      present ? `(SELECT count(*) FROM ${quoted(name)})::text` : "NULL";
    const { rows } = await this.postgres.query<{ source: string | null; archive: string | null }>(
      `SELECT ${count(source, exists.source)} AS "source", ${count(archive, exists.archive)} AS "archive"`,
    );
    const asNumber = (value: string | null | undefined) => (value == null ? null : Number(value));
    return { source: asNumber(rows[0]?.source), archive: asNumber(rows[0]?.archive) };
  }

  /** Rebuilds the archive from the live source in one implicit transaction; the source stays. */
  async copy({ source, archive }: { source: string; archive: string }): Promise<void> {
    await this.postgres.query(
      `DROP TABLE IF EXISTS ${quoted(archive)}; CREATE TABLE ${quoted(archive)} AS TABLE ${quoted(source)};`,
    );
  }
}
