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

/**
 * The one place `initTRPC` is called. Feature packages ask for a root here
 * rather than initializing tRPC themselves, so every root in the process
 * carries the same context discipline.
 *
 * The builder is answered as tRPC hands it over, un-narrowed, and `create` is
 * called on it directly. A wrapper `create` of our own cannot forward the
 * options object without erasing it: `TRPCBuilder.create` derives the root's
 * `errorShape` and `transformer` from the literal type of the options it is
 * given, and a forwarding method can only pass a type parameter, which the
 * inference reads as `never`. The root then reports `errorShape: never` and
 * every `error.data.<field>` read on the client is a read off `never`.
 */
export class TrpcRootDefinition {
  private constructor() {}

  static forContext<TContext extends object>() {
    return initTRPC.context<TContext>();
  }
}
