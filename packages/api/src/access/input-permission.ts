/**
 * A permission chosen from the parsed input (E3): a declared map from each value of one input
 * field to the permission it asks, never a callback, so the document, the authz sweep and the
 * linter can all read it. See dev/docs/plans/api-framework-extensions-design-2026-10-05.md.
 */
import {
  permissionGrantTiers,
  type AuthzPermission,
  type DeclaredScopeTier,
} from "@langwatch/authorization";
import { z } from "zod";

/** The permission alone, asked where the declaration's own target says, or with its own scope. */
export type PermissionChoice =
  | AuthzPermission
  | Readonly<{ permission: AuthzPermission; tier: DeclaredScopeTier; field: string }>;

export type PermissionMap = Readonly<Record<string, PermissionChoice>>;

export type InputPermission<
  Field extends string = string,
  Map extends PermissionMap = PermissionMap,
> = Readonly<{ kind: "permission-by-input"; field: Field; map: Map }>;

/** `field` is a dotted path into the parsed input; the map names every value it can hold. */
export function permissionBy<const Field extends string, const Map extends PermissionMap>({
  field,
  map,
}: Readonly<{ field: Field; map: Map }>): InputPermission<Field, Map> {
  return { kind: "permission-by-input", field, map };
}

export function isInputPermission(value: unknown): value is InputPermission {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "permission-by-input"
  );
}

type PathValue<Value, Path extends string> = Value extends unknown
  ? Path extends `${infer Head}.${infer Rest}`
    ? Head extends keyof Value
      ? PathValue<NonNullable<Value[Head]>, Rest>
      : never
    : Path extends keyof Value
      ? Value[Path]
      : never
  : never;

/**
 * The declaration when its map's keys are exactly the values its field can hold, else `never`, so a
 * new value in the contract is a compile error rather than a silent hole. An unknown input passes.
 */
export type ExactInputPermission<Input, Choice extends InputPermission> = [Input] extends [
  undefined,
]
  ? Choice
  : [
        Exclude<PathValue<Input, Choice["field"]>, keyof Choice["map"]>,
        Exclude<keyof Choice["map"], PathValue<Input, Choice["field"]>>,
      ] extends [never, never]
    ? Choice
    : never;

/** Every permission the map can ask, once each, in the order it names them. */
export function permissionsOfChoice(declared: InputPermission): readonly AuthzPermission[] {
  const named = Object.values(declared.map).map((entry) =>
    typeof entry === "string" ? entry : entry.permission,
  );

  return [...new Set(named)];
}

/** The value at a dotted path, or undefined where any step is missing. */
export function valueAtPath(input: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => {
    if (typeof value !== "object" || value === null) return undefined;

    return Object.hasOwn(value, key) ? Reflect.get(value, key) : undefined;
  }, input);
}

/**
 * Refuses, where it is written, a map whose keys are not exactly the values its field parses
 * as, an entry naming a scope field its input never parses, and a permission asked at a tier
 * that cannot grant it.
 */
export function assertInputPermission({
  address,
  declared,
  schemas,
}: {
  address: string;
  declared: InputPermission;
  schemas: readonly z.ZodType[];
}): void {
  const keys = Object.keys(declared.map);
  const values = enumerableValues(schemas.flatMap((schema) => schemasAt(schema, declared.field)));

  if (values === null) {
    throw new Error(
      `${address} chooses its permission by "${declared.field}", which its input does not ` +
        "parse as a fixed set of values",
    );
  }

  const unnamed = values.filter((value) => !keys.includes(value));
  const extra = keys.filter((key) => !values.includes(key));

  if (unnamed.length > 0 || extra.length > 0) {
    throw new Error(
      `${address} chooses its permission by "${declared.field}", and its map must name exactly ` +
        `the values it parses as (unnamed: ${unnamed.join(", ") || "none"}; ` +
        `not parsed: ${extra.join(", ") || "none"})`,
    );
  }

  for (const entry of Object.values(declared.map)) {
    if (typeof entry === "string") continue;

    if (!permissionGrantTiers(entry.permission).includes(entry.tier)) {
      throw new Error(
        `${address} asks "${entry.permission}" at a ${entry.tier}, a tier that cannot grant it`,
      );
    }

    if (schemas.flatMap((schema) => schemasAt(schema, entry.field)).length === 0) {
      throw new Error(
        `${address} asks "${entry.permission}" at the scope "${entry.field}" names, a field ` +
          "its input does not parse",
      );
    }
  }
}

/** Every schema the path can reach, through objects, unions, intersections and wrappers. */
function schemasAt(schema: z.ZodType, path: string): z.ZodType[] {
  const [head, ...rest] = path.split(".");
  const found = branchesOf(schema).flatMap((branch) =>
    branch instanceof z.ZodObject && head !== undefined && Object.hasOwn(branch.shape, head)
      ? [branch.shape[head] as z.ZodType]
      : [],
  );

  return rest.length === 0 ? found : found.flatMap((child) => schemasAt(child, rest.join(".")));
}

function branchesOf(schema: z.ZodType): z.ZodType[] {
  const inner = unwrapped(schema);

  if (inner instanceof z.ZodUnion) return (inner.options as z.ZodType[]).flatMap(branchesOf);
  if (inner instanceof z.ZodIntersection) {
    return [
      ...branchesOf(inner.def.left as z.ZodType),
      ...branchesOf(inner.def.right as z.ZodType),
    ];
  }

  return [inner];
}

function unwrapped(schema: z.ZodType): z.ZodType {
  if (schema instanceof z.ZodPipe) return unwrapped(schema.def.in as z.ZodType);

  const inner = (schema.def as { innerType?: z.ZodType }).innerType;

  return inner ? unwrapped(inner) : schema;
}

function namedValues(schema: z.ZodType): readonly unknown[] | null {
  if (schema instanceof z.ZodEnum) return Object.values(schema.enum);
  if (schema instanceof z.ZodLiteral) return [...schema.values];

  return null;
}

/** The string values the schemas parse as, or null when any of them is open-ended. */
function enumerableValues(schemas: readonly z.ZodType[]): string[] | null {
  if (schemas.length === 0) return null;

  const values = new Set<string>();

  for (const schema of schemas.flatMap(branchesOf)) {
    const named = namedValues(schema);

    if (!named || !named.every((value) => typeof value === "string")) return null;

    for (const value of named) values.add(value);
  }

  return [...values];
}
