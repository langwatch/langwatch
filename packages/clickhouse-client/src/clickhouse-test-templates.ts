/**
 * A schema built once per ClickHouse server and copied into each test file's own database, so
 * files that need the shipped migrations stop replaying them one after another under the schema
 * lock. Spec: specs/ci/package-suite-integration-lane.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";

import { ClickHouseSchemaLock } from "./schema-lock.ts";

/** The table a finished template holds; the clone leaves it behind. */
export const TEMPLATE_READY_TABLE = "_langwatch_template_ready";

const VIEW_ENGINES = new Set(["View", "MaterializedView", "LiveView", "WindowView", "Dictionary"]);

interface TemplateObject {
  name: string;
  engine: string;
  create_table_query: string;
  total_rows: string | number | null;
}

/**
 * Builds `template` once per server, then gives `target` the same tables, views and rows,
 * both under the machine-wide schema lock. `build` receives the held lock, so a migration task it
 * starts re-enters it instead of waiting on this caller.
 */
export async function cloneClickHouseTemplate({
  client,
  template,
  target,
  build,
  supersedes,
  lock = ClickHouseSchemaLock.create(),
}: {
  /** An administrative client on the server, not bound to either database. */
  client: ClickHouseClient;
  /** Name it by what it holds (a digest of the migrations), so a changed schema builds anew. */
  template: string;
  target: string;
  build: (input: { database: string; lock: ClickHouseSchemaLock }) => Promise<void>;
  /** The name every version of this template starts with; building drops the other versions. */
  supersedes?: string;
  lock?: ClickHouseSchemaLock;
}): Promise<void> {
  // The copy holds the lock too, so building another version never drops its source mid-copy.
  const release = await lock.acquire();
  try {
    if (!(await isTemplateReady({ client, template }))) {
      if (supersedes) await dropOtherVersions({ client, template, prefix: supersedes });
      await client.command({ query: `DROP DATABASE IF EXISTS ${template} SYNC` });
      await client.command({ query: `CREATE DATABASE ${template}` });
      await build({ database: template, lock });
      await client.command({
        query: `CREATE TABLE ${template}.${TEMPLATE_READY_TABLE} (ready UInt8) ENGINE = TinyLog`,
      });
    }
    await cloneClickHouseDatabase({ client, from: template, to: target });
  } finally {
    release();
  }
}

/** Drops the databases named like `prefix` other than `template`: schemas no checkout builds. */
async function dropOtherVersions({
  client,
  template,
  prefix,
}: {
  client: ClickHouseClient;
  template: string;
  prefix: string;
}): Promise<void> {
  const result = await client.query({
    query:
      "SELECT name FROM system.databases WHERE startsWith(name, {prefix:String}) AND name != {template:String}",
    query_params: { prefix, template },
    format: "JSONEachRow",
  });
  for (const { name } of await result.json<{ name: string }>()) {
    await client.command({ query: `DROP DATABASE IF EXISTS \`${name}\` SYNC` });
  }
}

async function isTemplateReady({
  client,
  template,
}: {
  client: ClickHouseClient;
  template: string;
}): Promise<boolean> {
  const result = await client.query({
    query:
      "SELECT count() AS n FROM system.tables WHERE database = {db:String} AND name = {name:String}",
    query_params: { db: template, name: TEMPLATE_READY_TABLE },
    format: "JSONEachRow",
  });
  const [row] = await result.json<{ n: string | number }>();
  return Number(row?.n) > 0;
}

/**
 * Recreates `to` with every object of `from`, their statements read back from the server and
 * pointed at `to`. Tables come first and get their rows, then views, so a materialised view
 * never sees the copied rows; an object waiting on another not yet created is retried.
 */
export async function cloneClickHouseDatabase({
  client,
  from,
  to,
}: {
  client: ClickHouseClient;
  from: string;
  to: string;
}): Promise<void> {
  const result = await client.query({
    query:
      "SELECT name, engine, create_table_query, total_rows FROM system.tables " +
      "WHERE database = {db:String} AND NOT startsWith(name, '.inner') AND name != {ready:String}",
    query_params: { db: from, ready: TEMPLATE_READY_TABLE },
    format: "JSONEachRow",
  });
  const objects = await result.json<TemplateObject>();
  const statementFor = (object: TemplateObject) =>
    redirectDatabase({ statement: object.create_table_query, from, to });

  await client.command({ query: `DROP DATABASE IF EXISTS ${to} SYNC` });
  await client.command({ query: `CREATE DATABASE ${to}` });

  const tables = objects.filter((object) => !VIEW_ENGINES.has(object.engine));
  const views = objects.filter((object) => VIEW_ENGINES.has(object.engine));
  await createAll({ client, statements: tables.map(statementFor) });
  await inParallel({
    items: tables.filter((table) => Number(table.total_rows ?? 0) > 0),
    run: async (table) => {
      await client.command({
        query: `INSERT INTO ${to}.${table.name} SELECT * FROM ${from}.${table.name}`,
      });
    },
  });
  await createAll({ client, statements: views.map(statementFor) });
}

/** One single-quoted SQL literal, escapes included. */
const STRING_LITERAL = /'(?:[^'\\]|\\.|'')*'/g;

/** Points every `from.` qualifier in a statement at `to`, leaving string literals as written. */
export function redirectDatabase({
  statement,
  from,
  to,
}: {
  statement: string;
  from: string;
  to: string;
}): string {
  const qualifier = new RegExp(`(?<![\\w.])\`?${from}\`?\\.`, "g");
  const redirect = (code: string) => code.replace(qualifier, `${to}.`);
  let result = "";
  let last = 0;
  for (const literal of statement.matchAll(STRING_LITERAL)) {
    result += redirect(statement.slice(last, literal.index)) + literal[0];
    last = literal.index + literal[0].length;
  }
  return result + redirect(statement.slice(last));
}

/** Statements in flight at once; DDL on an Atomic database runs concurrently. */
const CLONE_CONCURRENCY = 8;

/** Runs every statement, retrying the ones that failed until a pass makes no progress. */
async function createAll({
  client,
  statements,
}: {
  client: ClickHouseClient;
  statements: readonly string[];
}): Promise<void> {
  let pending = [...statements];
  while (pending.length > 0) {
    const failed: { statement: string; error: unknown }[] = [];
    await inParallel({
      items: pending,
      run: async (statement) => {
        try {
          await client.command({ query: statement });
        } catch (error) {
          failed.push({ statement, error });
        }
      },
    });
    if (failed.length === pending.length) throw failed[0]?.error;
    pending = failed.map(({ statement }) => statement);
  }
}

async function inParallel<T>({
  items,
  run,
}: {
  items: readonly T[];
  run: (item: T) => Promise<void>;
}): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next++] as T;
      await run(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CLONE_CONCURRENCY, items.length) }, worker));
}
