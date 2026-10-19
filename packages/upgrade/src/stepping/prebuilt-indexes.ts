/** An index of a name the check asks for, as the catalogue holds it. */
type HeldIndexRow = { name: string; definition: string; valid: boolean };

/** The one catalogue read the check makes; an `UpgradePostgres` fits as it is. */
export type IndexCatalogue = {
  query(text: string, values: unknown[]): Promise<{ rows: HeldIndexRow[] }>;
};

type ExpectedIndex = { migration: string; statement: string; shape: IndexShape };

/** One index as far as a pre-built one under its name is compared: null columns are expressions. */
type IndexShape = Readonly<{
  name: string;
  table: string;
  unique: boolean;
  method: string;
  columns: readonly string[] | null;
  partial: boolean;
}>;

/** A pending folder's `CREATE INDEX IF NOT EXISTS` that an index already holding its name skips. */
export type DifferingIndex = Readonly<{
  migration: string;
  name: string;
  table: string;
  should: string;
  is: string;
}>;

const IDENT = `(?:"[^"]+"|[A-Za-z_][\\w$]*)`;
const CREATE_INDEX = new RegExp(
  `^CREATE\\s+(UNIQUE\\s+)?INDEX\\s+(?:CONCURRENTLY\\s+)?(IF\\s+NOT\\s+EXISTS\\s+)?(${IDENT})` +
    `\\s+ON\\s+(?:ONLY\\s+)?((?:${IDENT}\\.)?${IDENT})\\s*(?:USING\\s+(\\w+)\\s*)?\\(`,
  "i",
);
const DROP_INDEX = new RegExp(
  `^DROP\\s+INDEX\\s+(?:CONCURRENTLY\\s+)?(?:IF\\s+EXISTS\\s+)?((?:${IDENT}\\.)?${IDENT}(?:\\s*,\\s*(?:${IDENT}\\.)?${IDENT})*)`,
  "i",
);
const RENAME_INDEX = new RegExp(
  `^ALTER\\s+INDEX\\s+(?:IF\\s+EXISTS\\s+)?((?:${IDENT}\\.)?${IDENT})\\s+RENAME\\s+TO\\s+(${IDENT})`,
  "i",
);
const DROP_CONSTRAINT = new RegExp(
  `\\bDROP\\s+CONSTRAINT\\s+(?:IF\\s+EXISTS\\s+)?(${IDENT})`,
  "gi",
);
const PLAIN_COLUMN = new RegExp(
  `^(${IDENT})(?:\\s+(ASC|DESC))?(?:\\s+NULLS\\s+(FIRST|LAST))?$`,
  "i",
);

/** An identifier as Postgres stores it: quoted kept, unquoted folded, the schema dropped. */
function bareName(identifier: string): string {
  const last = identifier.match(new RegExp(`${IDENT}$`))?.[0] ?? identifier;
  return last.startsWith('"') ? last.slice(1, -1) : last.toLowerCase();
}

function statementsOf(sql: string): string[] {
  const live = sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
  return live.split(";").map((text) => text.replace(/\s+/g, " ").trim());
}

/** Top-level comma-separated items of a parenthesised list starting at `open`, and what follows. */
function listAt(text: string, open: number): { items: string[]; rest: string } | null {
  let depth = 0;
  let start = open + 1;
  const items: string[] = [];
  for (let at = open; at < text.length; at++) {
    const char = text[at];
    if (char === "(") depth++;
    if (char === ")" && --depth === 0) {
      items.push(text.slice(start, at).trim());
      return { items, rest: text.slice(at + 1) };
    }
    if (char === "," && depth === 1) {
      items.push(text.slice(start, at).trim());
      start = at + 1;
    }
  }
  return null;
}

/** A key column as `pg_get_indexdef` prints it: default order and nulls left out. */
function plainColumn(item: string): string | null {
  const match = PLAIN_COLUMN.exec(item);
  if (!match) return null;
  const descending = match[2]?.toUpperCase() === "DESC";
  const nulls = match[3]?.toUpperCase();
  const defaultNulls = descending ? "FIRST" : "LAST";
  const order = descending ? " DESC" : "";
  return `${bareName(match[1]!)}${order}${nulls && nulls !== defaultNulls ? ` NULLS ${nulls}` : ""}`;
}

/** A `CREATE INDEX` statement's shape; also reads what `pg_get_indexdef` prints. */
export function indexShapeOf(statement: string): (IndexShape & { ifNotExists: boolean }) | null {
  const head = CREATE_INDEX.exec(statement);
  if (!head) return null;
  const list = listAt(statement, head[0].length - 1);
  if (!list) return null;
  const columns = list.items.map(plainColumn);
  const plain = columns.filter((column) => column !== null);
  return {
    name: bareName(head[3]!),
    table: bareName(head[4]!),
    unique: head[1] !== undefined,
    ifNotExists: head[2] !== undefined,
    method: (head[5] ?? "btree").toLowerCase(),
    columns: plain.length === columns.length ? plain : null,
    partial: /\bWHERE\b/i.test(list.rest),
  };
}

/** The names a statement drops or renames away, so a later create of them is not pre-built. */
function namesTouched(statement: string): string[] {
  const dropped = DROP_INDEX.exec(statement)?.[1]
    ?.split(",")
    .map((name) => bareName(name.trim()));
  const renamed = RENAME_INDEX.exec(statement);
  const constraints = [...statement.matchAll(DROP_CONSTRAINT)].map((match) => bareName(match[1]!));
  return [
    ...(dropped ?? []),
    ...(renamed ? [bareName(renamed[1]!), bareName(renamed[2]!)] : []),
    ...constraints,
  ];
}

/** Each `IF NOT EXISTS` create not dropped, renamed or created earlier in the pending folders. */
function expectedIndexes({
  folders,
}: {
  folders: readonly Readonly<{ name: string; sql: string }>[];
}): ExpectedIndex[] {
  const touched = new Set<string>();
  const expected: ExpectedIndex[] = [];
  for (const folder of folders) {
    for (const statement of statementsOf(folder.sql)) {
      const shape = indexShapeOf(statement);
      if (shape?.ifNotExists && !touched.has(shape.name))
        expected.push({ migration: folder.name, statement, shape });
      if (shape) touched.add(shape.name);
      for (const name of namesTouched(statement)) touched.add(name);
    }
  }
  return expected;
}

function sameShape(left: IndexShape, right: IndexShape): boolean {
  const columns =
    left.columns === null || right.columns === null
      ? left.columns === right.columns
      : left.columns.join(",") === right.columns.join(",");
  return (
    columns &&
    left.table === right.table &&
    left.unique === right.unique &&
    left.method === right.method &&
    left.partial === right.partial
  );
}

/**
 * Before pending folders apply: each `CREATE INDEX IF NOT EXISTS` whose name an index already
 * holds with another definition, or invalid, which the folder would skip in silence (T9-F3).
 * Expressions and predicates are compared by presence only. Nothing is ever dropped here.
 */
export async function differingPrebuiltIndexes({
  postgres,
  folders,
}: {
  postgres: IndexCatalogue;
  folders: readonly Readonly<{ name: string; sql: string }>[];
}): Promise<DifferingIndex[]> {
  const expected = expectedIndexes({ folders });
  if (expected.length === 0) return [];
  const { rows } = await postgres.query(
    `SELECT c.relname AS name, pg_get_indexdef(c.oid) AS definition, i.indisvalid AS valid
       FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
      WHERE c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())
        AND c.relname = ANY($1::text[])`,
    [expected.map(({ shape }) => shape.name)],
  );
  const held = new Map(rows.map((row) => [row.name, row]));
  return expected.flatMap(({ migration, statement, shape }) => {
    const existing = held.get(shape.name);
    if (!existing) return [];
    const actual = indexShapeOf(existing.definition);
    if (existing.valid && actual && sameShape(shape, actual)) return [];
    const invalid = existing.valid ? "" : " (invalid: a build that never finished)";
    const is = `${existing.definition}${invalid}`;
    return [{ migration, name: shape.name, table: shape.table, should: statement, is }];
  });
}
