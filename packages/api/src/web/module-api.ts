import type { TRPCUntypedClient } from "@trpc/client";
import { type CreateTRPCReact, createTRPCReact } from "@trpc/react-query";
// Load-bearing, not convenience: a web package's `export const fooApi =
// createModuleApi<FooMap>()` emits a declaration naming these, and only this
// package depends on `@trpc/react-query`. Without them TS2883 refuses the
// emit and asks every call site for a hand-written annotation.
export type {
  DecorateRouterRecord,
  UseTRPCMutationResult,
  UseTRPCQueryResult,
} from "@trpc/react-query/shared";
import type {
  AnyTRPCRootTypes,
  inferRouterOutputs,
  TRPCBuiltRouter,
  TRPCMutationProcedure,
  TRPCQueryProcedure,
  TRPCSubscriptionProcedure,
} from "@trpc/server";

/**
 * One procedure as a feature web package describes it. Feature writes a plain nested map; this
 * package turns it into a router type. A `subscription` is a LIVE procedure served over SSE,
 * with `output` being ONE entry type, not the stream.
 */
export type ProcedureShape =
  | { query: { input: unknown; output: unknown } }
  | { mutation: { input: unknown; output: unknown } }
  | { subscription: { input: unknown; output: unknown } };

/**
 * A feature's procedures, nested exactly as the process's root router mounts
 * them. The nesting is load-bearing: those segments become the tRPC cache key.
 */
export type ModuleApiMap = { [segment: string]: ProcedureShape | ModuleApiMap };

/**
 * The two sides of a declared schema, read structurally: `z.input` and
 * `z.output` are themselves indexed reads of `_zod`, so this package needs no
 * zod dependency to read the same answer.
 */
type SchemaInput<Schema> = Schema extends { _zod: { input: infer Value } } ? Value : never;
/** A member declared without output answers nothing. @see SchemaInput */
type SchemaOutput<Schema> = Schema extends { _zod: { output: infer Value } } ? Value : void;

type ContractIo<Input, Output> = {
  input: SchemaInput<Input>;
  output: SchemaOutput<Output>;
};

/** One declared procedure, in the shape {@link ProcedureShape} states by hand. */
type ContractMemberShape<Member> = Member extends {
  kind: infer Kind;
  input: infer Input;
  output: infer Output;
}
  ? Kind extends "query"
    ? { query: ContractIo<Input, Output> }
    : Kind extends "mutation"
      ? { mutation: ContractIo<Input, Output> }
      : { subscription: ContractIo<Input, Output> }
  : never;

/**
 * Map a tRPC contract describes, keyed by namespace. A dotted namespace (`"analytics.lwql"`)
 * declares a member namespace, nested under its parent.
 */
type NamespaceKeyed<Namespace extends string, Procedures> =
  Namespace extends `${infer Head}.${infer Rest}`
    ? { [Segment in Head]: NamespaceKeyed<Rest, Procedures> }
    : { [Segment in Namespace]: Procedures };

export type ContractApiMap<TContract> = TContract extends {
  namespace: infer Namespace extends string;
  members: infer Members;
}
  ? NamespaceKeyed<Namespace, { [Name in keyof Members]: ContractMemberShape<Members[Name]> }>
  : never;

type ProceduresFrom<TMap> = {
  [K in keyof TMap]: TMap[K] extends { query: { input: infer TIn; output: infer TOut } }
    ? TRPCQueryProcedure<{ input: TIn; output: TOut; meta: unknown }>
    : TMap[K] extends { mutation: { input: infer TIn; output: infer TOut } }
      ? TRPCMutationProcedure<{ input: TIn; output: TOut; meta: unknown }>
      : TMap[K] extends { subscription: { input: infer TIn; output: infer TOut } }
        ? TRPCSubscriptionProcedure<{ input: TIn; output: TOut; meta: unknown }>
        : ProceduresFrom<TMap[K]>;
};

/**
 * Root types a feature's router is built on. Only `transformer` is stated; `AnyTRPCRootTypes`
 * leaves it `any`, which makes tRPC hand back both serialized and original answers. `false` makes
 * tRPC apply `Serialize<>`, so Dates typed as ISO strings (as they actually arrive).
 */
type FeatureApiRootTypes = Omit<AnyTRPCRootTypes, "transformer"> & { transformer: false };

/** The router type a feature's map describes. */
export type RouterFromMap<TMap> = TRPCBuiltRouter<FeatureApiRootTypes, ProceduresFrom<TMap>>;

/**
 * Procedure output as the browser receives it. Read the map directly gives server-side shape;
 * `transformer: false` makes tRPC apply `Serialize<>`, so declared `Date` is an ISO string here.
 */
export type OutputsFromMap<TMap extends ModuleApiMap> = inferRouterOutputs<RouterFromMap<TMap>>;

/**
 * One value as the browser receives it, given the type the server states. The same `Serialize<>`
 * applies: Dates become ISO strings. Use this for props/parameters taking values off queries
 * declared by contract types the server also constructs.
 */
export type WireOf<TValue> = OutputsFromMap<{
  value: { query: { input: void; output: TValue } };
}>["value"];

/** Feature's typed tRPC hooks; cache keys derive from procedure path alone. */
export type ModuleApi<TMap extends ModuleApiMap> = CreateTRPCReact<RouterFromMap<TMap>, unknown>;

export function createModuleApi<TMap extends ModuleApiMap>(): ModuleApi<TMap> {
  return createTRPCReact<RouterFromMap<TMap>>();
}

/**
 * Transport a feature's hooks run on. Supplied by the process shell (never constructed in a
 * feature package). Sharing the one instance keeps one HTTP batching lane for application and
 * package queries fired in the same tick.
 */
export type ModuleApiClient<TMap extends ModuleApiMap> = TRPCUntypedClient<RouterFromMap<TMap>>;
