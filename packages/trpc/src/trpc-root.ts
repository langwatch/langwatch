import {
  initTRPC,
  type AnyTRPCRootTypes,
  type TRPCRuntimeConfigOptions,
  type TRPCRootObject,
} from "@trpc/server";

/**
 * Defines one typed tRPC root without choosing authentication, authorization,
 * audit, tracing, or error policy. A process constructs the root and then
 * builds the policy spine on it, supplying the concrete identity,
 * authorization, audit, error-reporting and cause-translation ports the spine
 * asks for.
 */
export type TrpcRoot<
  TContext extends object,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object> = TRPCRuntimeConfigOptions<
    TContext,
    object
  >,
> = Pick<
  TRPCRootObject<TContext, object, TOptions, AnyTRPCRootTypes>,
  "procedure" | "router" | "middleware"
>;

export class TrpcRootDefinition<TContext extends object> {
  private constructor() {}

  static forContext<TContext extends object>(): TrpcRootDefinition<TContext> {
    return new TrpcRootDefinition<TContext>();
  }

  create<TOptions extends TRPCRuntimeConfigOptions<TContext, object>>(options: TOptions) {
    return initTRPC.context<TContext>().create(options as never);
  }
}
