/**
 * A pure parser of `prisma/schema.prisma` text into the model/field facts the Postgres half of the
 * LangWatchQL catalog is derived from.
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
   * Present on every {@link kind} `"relation"` field: which of this model's columns hold the
   * foreign key, the related model's columns they reference, and the related model's name.
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
const FIELD_RE = /^(\w+)\s+(Unsupported\("[^"]*"\)|[A-Za-z_]\w*)(\[\]|\?)?\s*(.*)$/;

/**
 * Drops a trailing `//` line comment while respecting `"..."` strings, so a comment on a field line
 * is ignored without truncating a `@default("a//b")`.
 */
function stripLineComment(line: string): string {
  let inString = false;
  for (let i = 0; i < line.length - 1; i++) {
    const char = line[i];
    if (inString && char === "\\") {
      i++;
    } else if (char === '"') {
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

function parseFieldLine(line: string, documentation: string): ParsedFieldLine | null {
  const match = FIELD_RE.exec(line);
  if (!match) return null;
  const [, name, typeRaw, modifier, attributesRaw] = match;
  if (!name || !typeRaw) return null;
  const attributes = attributesRaw ?? "";

  const mapMatch = /@map\("([^"]*)"\)/.exec(attributes);
  const decimalMatch = /@db\.Decimal\((\d+)\s*,\s*(\d+)\)/.exec(attributes);
  const relationFieldsMatch = /@relation\([^)]*\bfields:\s*\[([^\]]*)\]/.exec(attributes);
  const relationReferencesMatch = /@relation\([^)]*\breferences:\s*\[([^\]]*)\]/.exec(attributes);

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

/** Mutable state threaded through the line-by-line scan in {@link parsePrismaSchema}. */
interface ParseState {
  readonly rawModels: RawModel[];
  readonly enums: PrismaEnum[];
  model: RawModel | undefined;
  isModelIgnored: boolean;
  enumCurrent: { name: string; values: string[] } | undefined;
  pendingDocs: string[];
}

/**
 * Consumes a `///` doc line or a blank/`//` line that breaks a doc block from
 * what follows. Returns `true` when the line was one of those (nothing left
 * for the caller to do with it).
 */
function consumeDocOrBlankLine({
  trimmed,
  state,
}: {
  trimmed: string;
  state: ParseState;
}): boolean {
  if (trimmed.startsWith("///")) {
    state.pendingDocs.push(docLine(trimmed));
    return true;
  }
  if (trimmed === "" || trimmed.startsWith("//")) {
    state.pendingDocs = [];
    return true;
  }
  return false;
}

/**
 * `pendingDocs` clears unconditionally here, on every line of the block: a `///` line above an enum
 * value is parsed like any other doc comment, but {@link PrismaEnum} carries no per-value
 * documentation, so it is discarded rather than attached to anything.
 */
function parseEnumLine({ line, state }: { line: string; state: ParseState }): void {
  const enumCurrent = state.enumCurrent;
  if (!enumCurrent) return;
  if (line === "}") {
    state.enums.push({ name: enumCurrent.name, values: enumCurrent.values });
    state.enumCurrent = undefined;
  } else if (!line.startsWith("@@")) {
    const value = /^(\w+)/.exec(line);
    if (value?.[1]) enumCurrent.values.push(value[1]);
  }
  state.pendingDocs = [];
}

/** A `@@map`/`@@id`/`@@ignore` block-attribute line inside a model. */
function applyModelAttributeLine({
  line,
  model,
  state,
}: {
  line: string;
  model: RawModel;
  state: ParseState;
}): void {
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
  if (/@@ignore\b/.test(line)) state.isModelIgnored = true;
  state.pendingDocs = [];
}

/** A field-declaration line inside a model, added unless `@ignore`d. */
function applyModelFieldLine({
  line,
  model,
  state,
}: {
  line: string;
  model: RawModel;
  state: ParseState;
}): void {
  const parsed = parseFieldLine(line, state.pendingDocs.join("\n"));
  state.pendingDocs = [];
  if (!parsed || parsed.isIgnored) return;
  model.fields.push(parsed.field);
  if (parsed.isId && model.primaryKey.length === 0) {
    model.primaryKey.push(parsed.field.name);
  }
}

/** A line inside `model X { ... }`: closing brace, `@@` attribute, or field. */
function parseModelLine({ line, state }: { line: string; state: ParseState }): void {
  const model = state.model;
  if (!model) return;
  if (line === "}") {
    if (!state.isModelIgnored) state.rawModels.push(model);
    state.model = undefined;
    state.pendingDocs = [];
    return;
  }
  if (line.startsWith("@@")) {
    applyModelAttributeLine({ line, model, state });
    return;
  }
  applyModelFieldLine({ line, model, state });
}

/** A top-level line: opens a `model` or `enum` block, otherwise is ignored. */
function startModelOrEnum({ line, state }: { line: string; state: ParseState }): void {
  const modelStart = /^model\s+(\w+)\s*\{/.exec(line);
  if (modelStart?.[1]) {
    state.model = {
      name: modelStart[1],
      tableName: modelStart[1],
      documentation: state.pendingDocs.join("\n"),
      primaryKey: [],
      fields: [],
    };
    state.isModelIgnored = false;
    state.pendingDocs = [];
    return;
  }
  const enumStart = /^enum\s+(\w+)\s*\{/.exec(line);
  if (enumStart?.[1]) {
    state.enumCurrent = { name: enumStart[1], values: [] };
  }
  state.pendingDocs = [];
}

/** Parses the datamodel out of `prisma/schema.prisma` text. */
export function parsePrismaSchema(text: string): PrismaManifest {
  const state: ParseState = {
    rawModels: [],
    enums: [],
    model: undefined,
    isModelIgnored: false,
    enumCurrent: undefined,
    pendingDocs: [],
  };

  for (const rawLine of text.split("\n")) {
    const trimmed = rawLine.trim();
    if (consumeDocOrBlankLine({ trimmed, state })) continue;

    const line = stripLineComment(trimmed).trimEnd();

    if (state.enumCurrent) {
      parseEnumLine({ line, state });
      continue;
    }
    if (state.model) {
      parseModelLine({ line, state });
      continue;
    }
    startModelOrEnum({ line, state });
  }

  return buildManifest({ rawModels: state.rawModels, enums: state.enums });
}

/**
 * Resolves every raw field's {@link PrismaFieldKind} against the full set of
 * model and enum names collected during the scan, producing the final manifest.
 */
function buildManifest({
  rawModels,
  enums,
}: {
  rawModels: readonly RawModel[];
  enums: readonly PrismaEnum[];
}): PrismaManifest {
  const modelNames = new Set(rawModels.map((entry) => entry.name));
  const enumNames = new Set(enums.map((entry) => entry.name));

  const models: PrismaModel[] = rawModels.map((entry) => ({
    name: entry.name,
    tableName: entry.tableName,
    documentation: entry.documentation,
    primaryKey: entry.primaryKey,
    fields: entry.fields.map((field) => resolveField({ field, modelNames, enumNames })),
  }));

  return { models, enums };
}

/** Resolves one raw field's {@link PrismaFieldKind} and attaches `relation` when applicable. */
function resolveField({
  field,
  modelNames,
  enumNames,
}: {
  field: RawField;
  modelNames: ReadonlySet<string>;
  enumNames: ReadonlySet<string>;
}): PrismaField {
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
