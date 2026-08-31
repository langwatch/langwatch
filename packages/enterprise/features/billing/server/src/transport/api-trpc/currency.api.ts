/**
 * The currency a visitor is quoted in, over the process's tRPC transport.
 *
 * One procedure. `detectCurrency` answers the pricing pages' only question:
 * which of the two currencies this reader's prices should be shown in, and
 * which country that was decided from. The decision itself is
 * {@link CurrencyService}'s — CDN country header, then a geo-IP lookup of the
 * client address, then the default — and lives in this package because the
 * currency a customer is billed in is billing's own rule.
 *
 * The request is the whole input: the headers a CDN injected are what the
 * answer is read from, so the procedure's own parser accepts anything and
 * names nothing. It carries no scope id and reads no tenant data.
 *
 * `noPermission`, not a permission: there is nothing to check. A currency
 * catalog is public reference data, the answer is identical for every signed-in
 * caller in the same place, and the declaration is what keeps that reviewable
 * rather than merely unchecked.
 *
 * SaaS-only: geo-IP detection depends on headers only the hosted CDN injects,
 * so a self-hosted installation gets an empty router of the same type from the
 * composition rather than a surface that guesses.
 */
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";
import { CurrencyService, type CurrencyRequest } from "../../services/currency.service";

/**
 * The process supplies the request; authorization arrives as the declaration.
 *
 * `req` is the one thing this surface reads off the context, and it is absent
 * on the compatibility callers that build a context without one — which the
 * service already answers for by falling back to the default currency.
 */
export type CurrencyTrpcContext = Readonly<{
  req: CurrencyRequest | undefined;
}>;

/** One procedure, wrapped in the process's policy chain. */
type ProcedureDecorator = <TProcedure>(procedure: TProcedure) => TProcedure;

type CurrencyTrpcProcedures<
  TContext extends CurrencyTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * Tracing, logging, error shaping, scope lineage, the opted-out declaration
   * and audit, applied AFTER this feature's input parser. The process composes
   * the chain and owns the written reason the declaration carries.
   */
  noPermission: ProcedureDecorator;
}>;

/**
 * Anything, and nothing is read from it.
 *
 * The pages call `detectCurrency({})`. Kept exactly as permissive as it has
 * always been: narrowing it would reject a caller that sends a stray field
 * today, and the handler reads the request rather than the input either way.
 */
const detectCurrencyInputSchema = z.object({}).passthrough();

/** Installs the complete `currency.*` tRPC surface on a process root. */
export class CurrencyTrpcApi {
  static create<
    TContext extends CurrencyTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: CurrencyTrpcProcedures<TContext, TOptions, TRoot>,
  ) {
    const { protected: procedure, noPermission } = procedures;
    const currencyService = CurrencyService.create();

    return trpc.router({
      /** The reader's currency and the country it was decided from. */
      detectCurrency: noPermission(procedure.input(detectCurrencyInputSchema)).query(({ ctx }) =>
        currencyService.detect(ctx.req),
      ),
    });
  }
}
