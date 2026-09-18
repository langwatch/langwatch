/**
 * A pure parser of `prisma/schema.prisma` text into the model/field facts the
 * Postgres half of the LangWatchQL catalog is derived from.
 *
 * ── WHY A HAND-ROLLED PARSER ────────────────────────────────────────────────
 * Prisma 7's generated client no longer exposes `Prisma.dmmf`, so the datamodel
 * has to be read from the schema text itself (the same reason
 * {@link ../../../../test-utils/prismaDatamodel.ts} exists — that one keeps
 * field names only and stays untouched). The derivation needs more than names:
 * each field's mapped column, its type, whether it is a list/optional, whether
 * it is a relation (relations are never columns but callers walk them to find
 * the owning tenant), its `@db.Decimal` precision, and the `///` docs that
 * become view/column descriptions. This module produces exactly those facts and
 * nothing else — no filesystem access, so it stays a small pure function the
 * generator and the parity test both call with the same text.
 *
 * The output is *generated*, never hand-edited: the generator writes it to
 * {@link ./prismaManifest.generated.json} and a parity test fails if the
 * committed file drifts from a fresh parse.
 *
 * @see ./prismaManifest.ts — the committed manifest and its accessors
 * @see ../../../../../scripts/generate-lwql-prisma-manifest.ts — the generator
 * @see ./__tests__/prismaManifestParity.unit.test.ts — the drift guard
 */

/** How a field's Prisma type resolves once every model/enum name is known. */
export type PrismaFieldKind = "scalar" | "enum" | "relation" | "unsupported";

/** One field of a model, with the facts a column is (or is not) built from. */
export interface PrismaField {
  /** Field name as written in the schema. */
  readonly name: string;
  /** Database column name — `@map("c")` when present, else the field name. */
  readonly columnName: string;
  /** Base type name with the `?`/`[]` modifiers stripped (e.g. `String`). */
  readonly type: string;
  /** What {@link type} refers to; relations and unsupported are never columns. */
  readonly kind: PrismaFieldKind;
  /** `Type[]` — a list column, mapped to `Array(T)` downstream. */
  readonly isList: boolean;
  /** `Type?` — a nullable column, mapped to `Nullable(T)` downstream. */
  readonly isOptional: boolean;
  /** The `///` lines directly above the field, joined by newlines (`""` if none). */
  readonly documentation: string;
  /** `@db.Decimal(p, s)` when annotated, so the mapped precision is exact. */
  readonly decimal?: { readonly precision: number; readonly scale: number };
  /**
   * Present on every {@link kind} `"relation"` field: which of this model's
   * columns hold the foreign key, the related model's columns they reference,
   * and the related model's name. `fields`/`references` are the field-name
   * lists written in `@relation(fields: [...], references: [...])` — empty on
   * the back-reference side, which declares no `fields:`. Callers walk this to
   * turn a scalar FK column into the model it points at (a seeder needs the
   * parent id; the derivation needs the owning tenant).
   */
  readonly relation?: {
    readonly fields: readonly string[];
    readonly references: readonly string[];
    readonly to: string;
  };
}

/** One model of the manifest. */
export interface PrismaModel {
  /** Model name as written (`model X { ... }`). */
  readonly name: string;
  /** Physical table — `@@map("t")` when present, else the model name. */
  readonly tableName: string;
  /** The `///` lines directly above the `model` keyword, newline-joined. */
  readonly documentation: string;
  /** Field name(s) of the primary key — the `@id` field, or the `@@id([...])` list. */
  readonly primaryKey: readonly string[];
  /** Every field, relations included; callers filter by {@link PrismaField.kind}. */
  readonly fields: readonly PrismaField[];
}

/** One enum, so a field whose type names it can be resolved to `kind: "enum"`. */
export interface PrismaEnum {
  readonly name: string;
  readonly values: readonly string[];
}

/** The whole datamodel, in source order. */
export interface PrismaManifest {
  readonly models: readonly PrismaModel[];
  readonly enums: readonly PrismaEnum[];
}

/** A field before its {@link PrismaFieldKind} is resolved against every name. */
interface RawField extends Omit<PrismaField, "kind" | "relation"> {
  /** `true` when the type is `Unsupported("...")` — resolves to `unsupported`. */
  readonly isUnsupported: boolean;
  /** `true` when the field carries `@relation` — resolves to `relation`. */
  readonly hasRelation: boolean;
  /** FK column field-names from `@relation(fields: [...])`, empty if none. */
  readonly relationFields: readonly string[];
  /** Referenced field-names from `@relation(references: [...])`, empty if none. */
  readonly relationReferences: readonly string[];
}

/** A model mid-parse: its table and key are still being read off attributes. */
interface RawModel {
  readonly name: string;
  tableName: string;
  readonly documentation: string;
  primaryKey: string[];
  readonly fields: RawField[];
}

/** A field line: `name Type[modifier] <attributes>`. */
const FIELD_RE =
  /^(\w+)\s+(Unsupported\("[^"]*"\)|[A-Za-z_]\w*)(\[\]|\?)?\s*(.*)$/;

/**
 * Drops a trailing `//` line comment while respecting `"..."` strings, so a
 * comment on a field line is ignored without truncating a `@default("a//b")`.
 * `///` doc lines are consumed before this runs, so only `//` reaches here.
 */
function stripLineComment(line: string): string {
  let inString = false;
  for (let i = 0; i < line.length - 1; i++) {
    const char = line[i];
    if (char === '"') {
      inString = !inString;
    } else if (!inString && char === "/" && line[i + 1] === "/") {
      return line.slice(0, i);
    }
  }
  return line;
}

/** The text of a `///` doc line: the content after `///`, trimmed. */
function docLine(trimmed: string): string {
  return trimmed.slice(3).trim();
}

/** A comma-separated `[a, b]` attribute list to a trimmed name array. */
function parseNameList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

/** `@id` on a field line, but not `@ignore` etc. — a whole-token match. */
const FIELD_ID_RE = /(?:^|\s)@id(?:\s|$)/;
/** `@ignore` on a field line — the field is dropped from the manifest. */
const FIELD_IGNORE_RE = /(?:^|\s)@ignore(?:\s|$)/;

/** A parsed field plus the `@id`/`@ignore` markers the model loop acts on. */
interface ParsedFieldLine {
  readonly field: RawField;
  readonly isId: boolean;
  readonly isIgnored: boolean;
}

function parseFieldLine(
  line: string,
  documentation: string,
): ParsedFieldLine | null {
  const match = FIELD_RE.exec(line);
  if (!match) return null;
  const [, name, typeRaw, modifier, attributesRaw] = match;
  if (!name || !typeRaw) return null;
  const attributes = attributesRaw ?? "";

  const mapMatch = /@map\("([^"]*)"\)/.exec(attributes);
  const decimalMatch = /@db\.Decimal\((\d+)\s*,\s*(\d+)\)/.exec(attributes);
  const relationFieldsMatch = /@relation\([^)]*\bfields:\s*\[([^\]]*)\]/.exec(
    attributes,
  );
  const relationReferencesMatch =
    /@relation\([^)]*\breferences:\s*\[([^\]]*)\]/.exec(attributes);

  return {
    field: {
      name,
      columnName: mapMatch?.[1] ?? name,
      type: typeRaw,
      isList: modifier === "[]",
      isOptional: modifier === "?",
      documentation,
      ...(decimalMatch
        ? {
            decimal: {
              precision: Number(decimalMatch[1]),
              scale: Number(decimalMatch[2]),
            },
          }
        : {}),
      isUnsupported: typeRaw.startsWith("Unsupported("),
      hasRelation: /@relation\b/.test(attributes),
      relationFields: parseNameList(relationFieldsMatch?.[1]),
      relationReferences: parseNameList(relationReferencesMatch?.[1]),
    },
    isId: FIELD_ID_RE.test(attributes),
    isIgnored: FIELD_IGNORE_RE.test(attributes),
  };
}

/**
 * Parses the datamodel out of `prisma/schema.prisma` text.
 *
 * A field's {@link PrismaFieldKind} needs the full set of model and enum names
 * (a relation is a field whose type is a model, or one carrying `@relation`), so
 * this collects raw fields first and resolves their kind in a second pass —
 * forward references to a model defined later in the file resolve correctly.
 * `@ignore` fields and `@@ignore` models are dropped so they never reach a view.
 */
export function parsePrismaSchema(text: string): PrismaManifest {
  const rawModels: RawModel[] = [];
  const enums: PrismaEnum[] = [];

  let model: RawModel | undefined;
  let modelIgnored = false;
  let enumCurrent: { name: string; values: string[] } | undefined;
  let pendingDocs: string[] = [];

  for (const rawLine of text.split("\n")) {
    const trimmed = rawLine.trim();

    if (trimmed.startsWith("///")) {
      pendingDocs.push(docLine(trimmed));
      continue;
    }
    // A blank line or a `//` comment breaks a doc block from what follows.
    if (trimmed === "" || trimmed.startsWith("//")) {
      pendingDocs = [];
      continue;
    }

    const line = stripLineComment(trimmed).trimEnd();

    if (enumCurrent) {
      if (line === "}") {
        enums.push({ name: enumCurrent.name, values: enumCurrent.values });
        enumCurrent = undefined;
      } else if (!line.startsWith("@@")) {
        const value = /^(\w+)/.exec(line);
        if (value?.[1]) enumCurrent.values.push(value[1]);
      }
      pendingDocs = [];
      continue;
    }

    if (model) {
      if (line === "}") {
        if (!modelIgnored) rawModels.push(model);
        model = undefined;
        pendingDocs = [];
        continue;
      }
      if (line.startsWith("@@")) {
        const mapMatch = /@@map\("([^"]*)"\)/.exec(line);
        if (mapMatch?.[1]) {
          model.tableName = mapMatch[1];
        }
        const idMatch = /@@id\(\[([^\]]*)\]/.exec(line);
        if (idMatch?.[1]) {
          model.primaryKey = idMatch[1]
            .split(",")
            .map((name) => name.trim())
            .filter(Boolean);
        }
        if (/@@ignore\b/.test(line)) modelIgnored = true;
        pendingDocs = [];
        continue;
      }
      const parsed = parseFieldLine(line, pendingDocs.join("\n"));
      pendingDocs = [];
      if (parsed && !parsed.isIgnored) {
        model.fields.push(parsed.field);
        if (parsed.isId && model.primaryKey.length === 0) {
          model.primaryKey.push(parsed.field.name);
        }
      }
      continue;
    }

    const modelStart = /^model\s+(\w+)\s*\{/.exec(line);
    if (modelStart?.[1]) {
      model = {
        name: modelStart[1],
        tableName: modelStart[1],
        documentation: pendingDocs.join("\n"),
        primaryKey: [],
        fields: [],
      };
      modelIgnored = false;
      pendingDocs = [];
      continue;
    }
    const enumStart = /^enum\s+(\w+)\s*\{/.exec(line);
    if (enumStart?.[1]) {
      enumCurrent = { name: enumStart[1], values: [] };
    }
    pendingDocs = [];
  }

  const modelNames = new Set(rawModels.map((entry) => entry.name));
  const enumNames = new Set(enums.map((entry) => entry.name));

  const models: PrismaModel[] = rawModels.map((entry) => ({
    name: entry.name,
    tableName: entry.tableName,
    documentation: entry.documentation,
    primaryKey: entry.primaryKey,
    fields: entry.fields.map((field) => {
      const kind = resolveKind({ field, modelNames, enumNames });
      return {
        name: field.name,
        columnName: field.columnName,
        type: field.type,
        kind,
        isList: field.isList,
        isOptional: field.isOptional,
        documentation: field.documentation,
        ...(field.decimal ? { decimal: field.decimal } : {}),
        ...(kind === "relation"
          ? {
              relation: {
                fields: field.relationFields,
                references: field.relationReferences,
                to: field.type,
              },
            }
          : {}),
      };
    }),
  }));

  return { models, enums };
}

/**
 * A relation is a field whose type names a model, or one carrying `@relation`;
 * the FK scalar beside it (`userId String`) stays a scalar because its type is
 * `String`, not a model. `Unsupported(...)` and enum types resolve on their own.
 */
function resolveKind({
  field,
  modelNames,
  enumNames,
}: {
  field: RawField;
  modelNames: ReadonlySet<string>;
  enumNames: ReadonlySet<string>;
}): PrismaFieldKind {
  if (field.isUnsupported) return "unsupported";
  if (field.hasRelation || modelNames.has(field.type)) return "relation";
  if (enumNames.has(field.type)) return "enum";
  return "scalar";
}
