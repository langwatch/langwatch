/**
 * The query masking the LangWatchQL image renders from CLICKHOUSE_MASKED_SETTINGS, for a stock
 * test server, and the reads that search every log a value could reach (ADR-200).
 * Spec: specs/lwql/isolation.feature
 */
import type { LangWatchQLClickHouseHarness } from "./lwql-clickhouse-harness.ts";

/** One server config file, as `startLangWatchQLClickHouse` installs it before the server starts. */
type ServerConfigFile = { name: string; target: string; contents: string };

/** The image's statement rule: a quoted, dollar-quoted or bare value after `<setting> =`. */
function statementRegexp(setting: string): string {
  return String.raw`(?i)[\x60"]?\b(${setting})\b[\x60"]?(?:\s|/\*.*?\*/)*=(?:\s|/\*.*?\*/)*(?:'(?:[^'\\]|\\.|'')*'|\$\$.*?\$\$|[^\s,;)]+)`;
}

/**
 * `config.d/query-masking.yaml` as #9458's `internal/render/masking.go` renders it, byte for byte:
 * three rules per masked setting (statement, URL, encoded URL), then one hiding every sha256 hex
 * value, which catches the capability where ClickHouse logs it folded. Not `query_log.Settings`.
 */
export function lwqlQueryMaskingConfigFile({
  settings,
}: {
  settings: readonly string[];
}): ServerConfigFile {
  const rules = settings.flatMap((setting) => [
    `        - name: hide ${setting} in a statement`,
    `          regexp: ${statementRegexp(setting)}`,
    String.raw`          replace: \1 = '[HIDDEN]'`,
    `        - name: hide ${setting} in a URL`,
    String.raw`          regexp: (?i)\b(${setting})=[^&\s"]*`,
    String.raw`          replace: \1=[HIDDEN]`,
    `        - name: hide ${setting} in an encoded URL`,
    String.raw`          regexp: (?i)\b(${setting})(?:%20|\+)*%3D[^&\s"]*`,
    String.raw`          replace: \1%3D[HIDDEN]`,
  ]);
  const hex = [
    "        - name: hide sha256 hex values",
    String.raw`          regexp: (?i)\b[0-9a-f]{64}\b`,
    "          replace: '[HIDDEN]'",
  ];
  return {
    name: "query-masking.yaml",
    target: "/etc/clickhouse-server/config.d/query-masking.yaml",
    contents: ["query_masking_rules:", "    rule:", ...rules, ...hex, ""].join("\n"),
  };
}

const SERVER_LOG = "/var/log/clickhouse-server/clickhouse-server.log";

/** Where a run's logging starts: a second on the server's clock, a byte in its log file. */
export type ServerLogMark = { at: string; bytes: number };

export async function markServerLogs(
  harness: LangWatchQLClickHouseHarness,
): Promise<ServerLogMark> {
  const result = await harness.admin.query({ query: "SELECT now() AS at", format: "JSONEachRow" });
  const [row] = await result.json<{ at: string }>();
  const size = await harness.container.exec(["stat", "-c", "%s", SERVER_LOG]);
  return { at: row?.at ?? "1970-01-01 00:00:00", bytes: Number(size.output.trim()) };
}

/**
 * Every log that holds `value` since the mark, by name. The logs are read out and searched here;
 * a search sent as SQL would log the value it looks for.
 */
export async function serverLogsHolding({
  harness,
  since,
  value,
}: {
  harness: LangWatchQLClickHouseHarness;
  since: ServerLogMark;
  value: string;
}): Promise<string[]> {
  await harness.admin.command({ query: "SYSTEM FLUSH LOGS" });
  const read = async (log: string, table: string, column: string) => {
    const result = await harness.admin.query({
      query: `SELECT ${column} AS line FROM system.${table} WHERE event_time >= {since:DateTime}`,
      query_params: { since: since.at },
      format: "JSONEachRow",
    });
    const rows = await result.json<{ line: string }>();
    return rows.map((row) => ({ log, line: row.line }));
  };
  const file = await harness.container.exec(["tail", "-c", `+${since.bytes + 1}`, SERVER_LOG]);
  const lines = [
    ...(await read("query_log.query", "query_log", "query")),
    ...(await read("query_log.Settings", "query_log", "toString(Settings)")),
    ...(await read("text_log", "text_log", "message")),
    ...file.output.split("\n").map((line) => ({ log: "server log file", line })),
  ];
  return [
    ...new Set(lines.filter(({ line }) => line.includes(value)).map(({ log }) => log)),
  ].toSorted();
}
