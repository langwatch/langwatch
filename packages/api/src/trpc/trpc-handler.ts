import type { z } from "zod";
import { actorSchema, toLedgerActor, type Actor } from "@langwatch/actor";
import { declaredScopeIdSchema, type AuthzDeclaredScopeId } from "@langwatch/authz-contract";
import { TRPCError } from "@trpc/server";

/** An authenticated tRPC actor, normalized with a stable identifier for every kind. */
export type TrpcHandlerActor = Actor & Readonly<{ id: string }>;

export type ApiHandlerAdapter<TContext, App> = <Input>(input: {
  readonly ctx: TContext;
  readonly input: Input;
  readonly signal: AbortSignal | undefined;
}) => Promise<Readonly<{ app: App; actor: unknown; scope: unknown }>>;

/** Opaque process binding installed by the API mount. */
export class TrpcHandlerBinding<TContext, App> {
  private constructor(private readonly resolver: ApiHandlerAdapter<TContext, App>) {}

  static create<TContext, App>(resolve: ApiHandlerAdapter<TContext, App>) {
    return new TrpcHandlerBinding(resolve);
  }

  static resolve<TContext, App, Input>(
    binding: TrpcHandlerBinding<TContext, App>,
    request: {
      readonly ctx: TContext;
      readonly input: Input;
      readonly signal: AbortSignal | undefined;
    },
  ) {
    return binding.resolver(request);
  }
}

export function createTrpcHandlerBinding<TContext, App>(
  resolve: ApiHandlerAdapter<TContext, App>,
): TrpcHandlerBinding<TContext, App> {
  return TrpcHandlerBinding.create(resolve);
}

export async function resolveTrustedHandlerArguments<TContext, App, Input>(
  binding: TrpcHandlerBinding<TContext, App>,
  request: {
    readonly ctx: TContext;
    readonly input: Input;
    readonly signal: AbortSignal | undefined;
  },
): Promise<Readonly<{ app: App; actor: TrpcHandlerActor; scope: AuthzDeclaredScopeId | null }>> {
  const resolved = await TrpcHandlerBinding.resolve(binding, request);
  if (resolved.actor === null) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication is required" });
  }
  const parsedActor = actorSchema.parse(resolved.actor);
  const ledgerActor = toLedgerActor(parsedActor);
  if (ledgerActor.id === null) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication is required" });
  }
  const actor: TrpcHandlerActor =
    parsedActor.type === "user" || parsedActor.type === "api_key"
      ? parsedActor
      : { ...parsedActor, id: ledgerActor.id };
  const scope = resolved.scope === null ? null : declaredScopeIdSchema.parse(resolved.scope);
  return {
    app: resolved.app,
    actor,
    scope,
  };
}

/** Process-owned adapter that resolves trusted values after policy has run. */
export async function parseGovernedOutput<TSchema extends z.ZodType>(
  schema: TSchema,
  value: unknown,
): Promise<z.output<TSchema>> {
  return schema.parseAsync(value);
}
