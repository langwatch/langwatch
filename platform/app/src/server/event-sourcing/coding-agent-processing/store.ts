import {
  type ClickHouseClient,
  createRowCodec,
  type WireCodec,
} from "@langwatch/clickhouse";
import type {
  ReplaceStore,
  StateRead,
  StoreContext,
  StoredState,
} from "@langwatch/event-sourcing";
import {
  type CodingAgentSessionIdentityState,
  codingAgentSessionIdentityStateSchema,
  identitySlotSchema,
  sessionKeySourceSchema,
} from "./schema";
import { type CodingAgentSessionsRow, codingAgentSessionsTable } from "./table";

/**
 * `coding_agent_sessions` is a wide, denormalized table the app's read paths
 * depend on, so this store maps state to columns rather than to one state
 * blob. The version gate runs on the `Version` cell alone, before anything
 * else is decoded (ADR-098 decision 6).
 */

const READ_YOUR_WRITES_SETTINGS = {
  select_sequential_consistency: 1,
} as const;

const READ_SQL =
  `SELECT ${codingAgentSessionsTable.columnNames.join(", ")} ` +
  `FROM ${codingAgentSessionsTable.name} ` +
  `WHERE TenantId = {tenantId:String} AND SessionId = {sessionId:String} ` +
  `ORDER BY UpdatedAt DESC LIMIT 1`;

/** The JSON shape `IdentityStateJson` round-trips — `codingAgentSessionIdentityStateSchema` itself, parsed defensively. */
function decodeIdentityStateJson(
  raw: string,
): CodingAgentSessionIdentityState | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = codingAgentSessionIdentityStateSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function rowToState(
  row: CodingAgentSessionsRow,
): CodingAgentSessionIdentityState | null {
  return decodeIdentityStateJson(row.IdentityStateJson);
}

function emptyString(value: string | null): string {
  return value ?? "";
}

function stateToRow(args: {
  tenantId: string;
  sessionId: string;
  state: CodingAgentSessionIdentityState;
  version: string;
  now: Date;
  retentionDays: number;
}): CodingAgentSessionsRow {
  const {
    tenantId,
    sessionId,
    state,
    version,
    now,
    retentionDays,
  } = args;
  const acceptedAt = state.startedAtMs > 0 ? new Date(state.startedAtMs) : now;
  return {
    TenantId: tenantId,
    SessionId: sessionId,
    SessionKeySource: state.sessionKeySource ?? "",
    Version: version,
    // Stamped once — at genesis — with the session's own earliest known
    // signal time where available, and never re-derived from a moving
    // field afterwards. A future re-key (see `table.ts`) would instead
    // preserve this across writes by reading it back; this store does not,
    // matching the same bounded, documented simplification
    // `@langwatch/clickhouse`'s own `createReplaceStore` makes for its
    // anchor columns.
    AcceptedAt: acceptedAt,
    StartedAt: new Date(state.startedAtMs || now.getTime()),
    CreatedAt: now,
    UpdatedAt: now,
    Agent: state.agent ?? "",
    AgentVersion: emptyString(state.agentVersion.value),
    FinalRequestId: emptyString(state.finalRequestId.value),
    UserId: emptyString(state.userId.value),
    TerminalType: emptyString(state.terminalType.value),
    Entrypoint: emptyString(state.entrypoint.value),
    PermissionMode: emptyString(state.permissionMode.value),
    StopReason: emptyString(state.stopReason.value),
    Truncated: state.truncated,
    IdentityStateJson: JSON.stringify(state),
    _retention_days: retentionDays,
  };
}

const DEFAULT_RETENTION_DAYS = 308;

export interface CodingAgentSessionsStoreArgs {
  readonly client: ClickHouseClient;
  readonly expectedVersion: string;
  /** @default createRowCodec() */
  readonly codec?: WireCodec;
}

export function createCodingAgentSessionsStore(
  args: CodingAgentSessionsStoreArgs,
): ReplaceStore<CodingAgentSessionIdentityState> {
  const { client, expectedVersion } = args;
  const codec = args.codec ?? createRowCodec();
  const wireColumns = codingAgentSessionsTable.columnNames.map(
    (name) => codingAgentSessionsTable.columns[name],
  );
  const versionIndex = codingAgentSessionsTable.columnNames.indexOf("Version");

  return {
    kind: "replace",

    async read(
      key: string,
      context: StoreContext,
    ): Promise<StateRead<CodingAgentSessionIdentityState>> {
      const result = await client.query({
        tenantId: context.tenantId,
        sql: READ_SQL,
        params: { tenantId: context.tenantId, sessionId: key },
        settings: READ_YOUR_WRITES_SETTINGS,
      });

      const row = result.rows[0];
      if (!row) return { kind: "absent" };

      // The version gate runs on the `Version` cell alone, at its declared
      // position, before the rest of the row is decoded (ADR-098 decision 6).
      let storedVersion: string | undefined;
      try {
        storedVersion = codingAgentSessionsTable.columns.Version.decode(
          row[versionIndex],
        );
      } catch (cause) {
        return { kind: "undecodable", storedVersion: undefined, cause };
      }

      if (storedVersion !== expectedVersion) {
        return { kind: "undecodable", storedVersion };
      }

      let decoded: CodingAgentSessionsRow;
      try {
        const [decodedRow] = codec.decodeRows<CodingAgentSessionsRow>({
          columns: wireColumns,
          columnNames: codingAgentSessionsTable.columnNames,
          header: result.header,
          rows: [row],
        });
        if (!decodedRow) return { kind: "undecodable", storedVersion };
        decoded = decodedRow;
      } catch (cause) {
        return { kind: "undecodable", storedVersion, cause };
      }

      const state = rowToState(decoded);
      if (state === null) {
        // `IdentityStateJson` is present but not decodable under the
        // current state schema — never treated as absent (ADR-098 decision
        // 6): a corrupt or pre-rewrite JSON blob is a decode failure, and
        // decode failures fold the aggregate onto a fresh accumulator only
        // over `undecodable`'s throw path, never silently.
        return { kind: "undecodable", storedVersion };
      }

      return {
        kind: "found",
        stored: { state, version: storedVersion },
      };
    },

    async write(
      key: string,
      stored: StoredState<CodingAgentSessionIdentityState>,
      context: StoreContext,
    ): Promise<void> {
      const row = stateToRow({
        tenantId: context.tenantId,
        sessionId: key,
        state: stored.state,
        version: stored.version,
        now: new Date(),
        retentionDays: context.retentionDays ?? DEFAULT_RETENTION_DAYS,
      });

      const encodedRows = codec.encodeRows({
        columns: wireColumns,
        columnNames: codingAgentSessionsTable.columnNames,
        rows: [row],
      });

      // Awaited to completion — durable-first by construction (ADR-098
      // decision 7): the caller knows the session's identity is durable
      // before `write()` returns.
      await client.insert({
        tenantId: context.tenantId,
        table: codingAgentSessionsTable.name,
        rows: encodedRows,
        columns: codingAgentSessionsTable.columnNames,
        target: { kind: "replacing" },
      });
    },
  };
}
