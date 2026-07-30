import {
  type ColumnDef,
  ch,
  defineTable,
  replacing,
} from "@langwatch/clickhouse";

/**
 * `AcceptedAt` anchors partitioning and TTL, not `StartedAt`: `StartedAt` is a
 * `Math.min` over contribution times, so it MOVES, and a moved sort-key value
 * is a brand new physical row to `ReplacingMergeTree`. The deployed table
 * still sorts on `StartedAt` and has neither `AcceptedAt` nor
 * `IdentityStateJson` — this is the target shape, and the re-key is debt.
 *
 * The deployed counter and breakdown columns are absent: every one of them is
 * a query over `coding_agent_session_contributions` now (ADR-103).
 */
function smallUint(chType: "UInt8" | "UInt16" | "UInt32"): ColumnDef<number> {
  const schema = ch.float64().schema.refine(
    (value) => Number.isInteger(value) && value >= 0,
    (value) => ({
      message: `"${String(value)}" is not a valid ${chType} wire value`,
    }),
  );
  return {
    chType,
    schema,
    decode: (cell) => schema.parse(cell),
    encode: (value) => value,
    frozen: false,
    platformControlled: false,
    nullable: false,
  };
}

const lowCardinalityString = () => ch.lowCardinality(ch.string());

export const codingAgentSessionsTable = defineTable({
  name: "coding_agent_sessions",
  // UpdatedAt is stamped by the store on every write — the `writtenAt` role
  // the ReplacingMergeTree version needs (ADR-099), unchanged from the
  // deployed engine.
  merge: replacing({ version: "UpdatedAt" }),
  sortKey: ["TenantId", "AcceptedAt", "SessionId"],
  partition: { by: "toYearWeek(AcceptedAt)", column: "AcceptedAt" },
  tenant: ["TenantId"],
  ttl: { anchor: "AcceptedAt" },
  columns: {
    TenantId: ch.string(),
    SessionId: ch.string(),
    SessionKeySource: lowCardinalityString(),
    /** The fold's state-version gate (ADR-098 decision 6) — reused unchanged from the deployed table. */
    Version: ch.string(),

    /** See the module docblock — requires a follow-up migration. The structural anchor: frozen, stamped once, never re-touched. */
    AcceptedAt: ch.acceptedAt(),
    /** The business "session started" value. Moves (`Math.min`); plays no structural role any more. */
    StartedAt: ch.occurredAt(),
    CreatedAt: ch.dateTime64(3),
    UpdatedAt: ch.writtenAt(),
    /** See the module docblock — requires a follow-up migration. */

    Agent: lowCardinalityString(),
    AgentVersion: lowCardinalityString(),
    FinalRequestId: ch.string(),
    UserId: ch.string(),
    TerminalType: lowCardinalityString(),
    Entrypoint: lowCardinalityString(),
    PermissionMode: lowCardinalityString(),
    StopReason: lowCardinalityString(),
    Truncated: ch.boolean(),

    /** See the module docblock — requires a follow-up migration. The identity fold's full round-trip source of truth. */
    IdentityStateJson: ch.string(),

    _retention_days: smallUint("UInt16"),
  },
});

export type CodingAgentSessionsRow = ReturnType<
  typeof codingAgentSessionsTable.rowSchema.parse
>;
