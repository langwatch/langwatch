import type { z } from "zod";
import { actorSchema, type Actor } from "@langwatch/actor";
import { declaredScopeIdSchema, type AuthzDeclaredScopeId } from "@langwatch/authz-contract";

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
): Promise<Readonly<{ app: App; actor: Actor | null; scope: AuthzDeclaredScopeId | null }>> {
  const resolved = await TrpcHandlerBinding.resolve(binding, request);
  const actor = resolved.actor === null ? null : actorSchema.parse(resolved.actor);
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
