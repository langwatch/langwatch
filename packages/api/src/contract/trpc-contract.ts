/**
 * A feature's tRPC declaration, stated once in a module the browser can read.
 * Design: packages/api/adrs/20260908-transport-declaration-split.md.
 * Spec: packages/api/specs/transport-declaration-split.feature.
 */

// The declaration names a procedure, its kind, its request schema and — when
// it answers with data — its response schema. Nothing else: no permission, no
// handler, no process generic. The server binds those to a name this file
// already declared, and the browser reads the same names and schemas as types.

import type { z } from "zod";

/** Every kind of procedure a contract declares. */
export type TrpcContractKind = "query" | "mutation" | "subscription";

/** One declared procedure. `output` is absent when the procedure answers nothing. */
export type TrpcContractMember<
  Kind extends TrpcContractKind = TrpcContractKind,
  Input extends z.ZodType = z.ZodType,
  Output extends z.ZodType | undefined = z.ZodType | undefined,
> = Readonly<{
  readonly kind: Kind;
  readonly input: Input;
  readonly output: Output;
}>;

/** The procedures of one namespace, keyed by the wire name. */
export type TrpcContractMembers = Readonly<Record<string, TrpcContractMember>>;

/** A built declaration: the namespace the process mounts it under, and its members. */
export type TrpcContract<
  Namespace extends string = string,
  Members extends TrpcContractMembers = TrpcContractMembers,
> = Readonly<{
  readonly namespace: Namespace;
  readonly members: Members;
}>;

/**
 * One more member, flattened. An intersection reads the same and types
 * differently — `keyof` over it stops distributing the way a router builder
 * needs — so the record is rebuilt on every step.
 */
type WithMember<
  Members extends TrpcContractMembers,
  Name extends string,
  Member extends TrpcContractMember,
> = {
  readonly [K in keyof Members | Name]: K extends Name
    ? Member
    : K extends keyof Members
      ? Members[K]
      : never;
};

/** The declaration chain: add a member, or build what has been declared. */
export interface TrpcContractBuilder<
  Namespace extends string,
  Members extends TrpcContractMembers,
> {
  /** A read. */
  query<Name extends string>(
    name: Name,
  ): TrpcContractInputBuilder<Namespace, Members, Name, "query">;
  /** A write. */
  mutation<Name extends string>(
    name: Name,
  ): TrpcContractInputBuilder<Namespace, Members, Name, "mutation">;
  /** A stream: `output` describes ONE value it yields, not the stream. */
  subscription<Name extends string>(
    name: Name,
  ): TrpcContractInputBuilder<Namespace, Members, Name, "subscription">;
  build(): TrpcContract<Namespace, Members>;
}

/** A named member still owing its request schema. */
export interface TrpcContractInputBuilder<
  Namespace extends string,
  Members extends TrpcContractMembers,
  Name extends string,
  Kind extends TrpcContractKind,
> {
  /** The request parser. Its OUTPUT is what a handler is handed. */
  withInput<Input extends z.ZodType>(
    schema: Input,
  ): TrpcContractOutputBuilder<Namespace, Members, Name, Kind, Input>;
}

/**
 * A declared member. `withOutput` states the answer; omitting it declares a
 * procedure that answers nothing, and a handler returning data then refuses.
 */
export interface TrpcContractOutputBuilder<
  Namespace extends string,
  Members extends TrpcContractMembers,
  Name extends string,
  Kind extends TrpcContractKind,
  Input extends z.ZodType,
> extends TrpcContractBuilder<
  Namespace,
  WithMember<Members, Name, TrpcContractMember<Kind, Input, undefined>>
> {
  withOutput<Output extends z.ZodType>(
    schema: Output,
  ): TrpcContractBuilder<
    Namespace,
    WithMember<Members, Name, TrpcContractMember<Kind, Input, Output>>
  >;
}

type MutableMembers = Record<string, TrpcContractMember>;

function contractBuilder<Namespace extends string, Members extends TrpcContractMembers>(
  namespace: Namespace,
  members: MutableMembers,
): TrpcContractBuilder<Namespace, Members> {
  const member = <Name extends string, Kind extends TrpcContractKind>(name: Name, kind: Kind) => ({
    withInput: (input: z.ZodType) => {
      assertUndeclared(namespace, name, members);
      const declared = { ...members, [name]: { kind, input, output: undefined } };
      return {
        ...contractBuilder(namespace, declared),
        withOutput: (output: z.ZodType) =>
          contractBuilder(namespace, { ...members, [name]: { kind, input, output } }),
      };
    },
  });

  return {
    query: (name) => member(name, "query"),
    mutation: (name) => member(name, "mutation"),
    subscription: (name) => member(name, "subscription"),
    build: () => ({ namespace, members: Object.freeze({ ...members }) as Members }),
  } as TrpcContractBuilder<Namespace, Members>;
}

function assertUndeclared(namespace: string, name: string, members: MutableMembers): void {
  if (name in members) {
    throw new Error(`tRPC contract "${namespace}" declares procedure "${name}" twice`);
  }
}

/**
 * Opens a feature's tRPC declaration under one namespace. The namespace is the
 * first segment of the browser's cache key, so it is the mounted name.
 */
export function defineTrpcContract<Namespace extends string>(
  namespace: Namespace,
): TrpcContractBuilder<Namespace, Record<never, never>> {
  return contractBuilder(namespace, {});
}
