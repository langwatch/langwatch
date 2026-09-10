/**
 * The audit sink a transport test reads its rows back from.
 *
 * A route declares `.withAudit("<action>")` and the REST runtime writes the
 * row, so the assertion belongs on the sink rather than on the app: a test that
 * hand-rolls `{ record: vi.fn() }` asserts on a call, not on a trail, and it
 * passes when the runtime writes nothing at all.
 *
 * The row shape is the runtime's own (`RestAuditRow` in `@langwatch/api/rest`),
 * described here rather than imported: the test harness is a dependency of
 * every package, and naming the REST runtime would put it on all their graphs.
 */

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
