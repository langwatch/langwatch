import type { OutputsFromMap, WireOf } from "@langwatch/api/web";
import type { Serialize } from "@trpc/server/unstable-core-do-not-import";
import { z } from "zod";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;
type Assert<Value extends true> = Value;

/** A recursive JSON type whose objects carry `undefined` members, as a stored column does. */
type StoredJson =
  | string
  | number
  | boolean
  | null
  | StoredJson[]
  | { [key: string]: StoredJson | undefined };

const storedJsonSchema: z.ZodType<StoredJson> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(storedJsonSchema),
    z.record(z.string(), storedJsonSchema),
  ]),
);
/** Dates arrive the way a contract produces them: from `z.date()`. */
const storedRowSchema = z.object({
  filters: storedJsonSchema,
  period: storedJsonSchema.nullable(),
  createdAt: z.date(),
});
type StoredRow = z.infer<typeof storedRowSchema>;

type _RecursiveJsonRoundTrips = Assert<Equal<WireOf<StoredJson>, StoredJson>>;
type _DateBecomesStringBesideRecursiveJson = Assert<
  Equal<WireOf<StoredRow>, { filters: StoredJson; period: StoredJson | null; createdAt: string }>
>;
type _ListOutputsDeriveToo = Assert<
  Equal<
    OutputsFromMap<{ rows: { query: { input: void; output: StoredRow[] } } }>["rows"][number],
    WireOf<StoredRow>
  >
>;

class Instance {
  name = "instance";
  method(): string {
    return this.name;
  }
}

/** Every non-recursive shape answers exactly what tRPC's own `Serialize<>` answers. */
const timestampSchema = z.date();
const shapesSchema = z.object({
  date: timestampSchema,
  optionalDate: timestampSchema.optional(),
  maybeDate: z.union([timestampSchema, z.undefined()]),
  nullableDate: timestampSchema.nullable(),
  nested: z.object({ at: timestampSchema, tags: z.array(z.string()), note: z.string().optional() }),
  rows: z.array(z.object({ at: timestampSchema, count: z.number() })),
  readonlyRows: z.array(z.object({ at: timestampSchema })).readonly(),
  tuple: z.tuple([timestampSchema, z.number()]),
  record: z.record(z.string(), timestampSchema),
  callback: z.custom<() => void>(),
  instance: z.instanceof(Instance),
  set: z.set(z.string()),
  map: z.map(z.string(), z.number()),
  bigUnion: z.union([z.literal("a"), z.literal("b"), z.object({ at: timestampSchema })]),
  unknownValue: z.unknown(),
  voidValue: z.void(),
});
type Shapes = z.infer<typeof shapesSchema>;
type Timestamp = z.infer<typeof timestampSchema>;

type _MatchesSerialize = Assert<Equal<WireOf<Shapes>, Serialize<Shapes>>>;
type _MatchesSerializeOnLists = Assert<Equal<WireOf<Shapes[]>, Serialize<Shapes[]>>>;
type _DateStillString = Assert<Equal<WireOf<Timestamp>, string>>;
type _VoidOutput = Assert<Equal<WireOf<void>, Serialize<void>>>;
