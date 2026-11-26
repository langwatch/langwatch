/**
 * A query driver over a ClickHouse server's HTTP interface, so integration suites need no client
 * package beyond clickhouse-client. Each request's settings are forwarded; pinned settings win.
 */
import type { QueryDriver, QueryRequest } from "@langwatch/clickhouse-client";

type Settings = Record<string, string | number>;

export function clickHouseHttpDriver({
  url,
  pinnedSettings = {},
  onExecute,
}: {
  url: string;
  /** Settings sent on every request, over whatever the request asks for. */
  pinnedSettings?: Settings;
  /** Sees every read before it is sent, for suites that assert on the statements run. */
  onExecute?: (request: QueryRequest) => void;
}): QueryDriver {
  const endpoint = new URL(url);
  const database = endpoint.pathname.replace(/^\//, "") || "default";
  const authorization = `Basic ${btoa(`${decodeURIComponent(endpoint.username)}:${decodeURIComponent(endpoint.password)}`)}`;
  const send = async (request: QueryRequest, body: string): Promise<string> => {
    const search = new URLSearchParams({ database });
    for (const [name, value] of Object.entries(request.params ?? {})) {
      search.set(`param_${name}`, httpParam(value));
    }
    for (const [name, value] of Object.entries({ ...request.settings, ...pinnedSettings })) {
      search.set(name, String(value));
    }
    const response = await fetch(`${endpoint.origin}/?${search.toString()}`, {
      method: "POST",
      headers: { authorization },
      body,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(text);
    return text;
  };
  return {
    async execute<Row>(request: QueryRequest) {
      onExecute?.(request);
      const text = await send(request, `${request.sql}\nFORMAT JSONEachRow`);
      return { rows: rowsOf<Row>(text) };
    },
    async insert(request) {
      const rows = request.rows.map((row) => JSON.stringify(row)).join("\n");
      await send(
        { tenantId: request.tenantId, sql: "", settings: request.settings },
        `INSERT INTO ${request.table} FORMAT JSONEachRow\n${rows}`,
      );
    },
    async command(request) {
      await send(request, request.sql);
    },
  };
}

/** JSONEachRow lines, typed by the caller as the vendor client's `json<Row>()` is. */
function rowsOf<Row>(text: string): Row[] {
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

/** One HTTP query parameter: arrays as ClickHouse literals, everything else as text. */
function httpParam(value: unknown): string {
  if (!Array.isArray(value)) return String(value);
  const quoted = value.map((each) =>
    typeof each === "number"
      ? String(each)
      : `'${String(each).replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`,
  );
  return `[${quoted.join(",")}]`;
}
