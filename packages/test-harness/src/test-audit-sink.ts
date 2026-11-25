// Audit sink for transport tests; assertions belong on the sink, not the app.

/** One row a finished route left: who, what, where, on what, and how it ended. */
export type TestAuditRow = Readonly<{
  actorId: string | null;
  action: string;
  scope: Readonly<{ tier: string; id: string }> | null;
  params: Readonly<Record<string, unknown>>;
  resultId: string | null;
  errorCode?: string;
}>;

/** Every row written so far, and the one reader a test asks a question with. */
export type TestAuditSink = Readonly<{
  record(row: TestAuditRow): void;
  /** Every row, in the order the runtime wrote them. */
  rows: readonly TestAuditRow[];
  /** The one row for `action`, or a refusal naming what was written instead. */
  only(action: string): TestAuditRow;
}>;

export function createTestAuditSink(): TestAuditSink {
  const rows: TestAuditRow[] = [];

  return {
    record: (row) => void rows.push(row),
    get rows() {
      return rows;
    },
    only: (action) => {
      const found = rows.filter((row) => row.action === action);

      if (found.length === 1 && found[0]) return found[0];

      throw new Error(
        `The audit sink holds ${found.length} rows for "${action}"; it holds ` +
          `[${rows.map((row) => row.action).join(", ")}]`,
      );
    },
  };
}
