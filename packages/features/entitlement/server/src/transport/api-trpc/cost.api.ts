/**
 * What an organization has SPENT, rolled up per project, over the process's
 * tRPC transport.
 *
 *   getAggregatedCostsForOrganization: every cost row the caller's projects
 *                                      recorded in one window, grouped the two
 *                                      ways the billing screen renders them.
 *
 * It lives beside `limits.*` and `plan.*` for the same reason those two do:
 * entitlement owns what a plan allows, and spend is the reading taken against
 * that allowance. The window is caller-supplied, and an end date within the
 * last hour is pulled forward to now so the panel shows the most recent rows
 * rather than a stale hour.
 *
 * It takes `organization:view` — every member sees the spend of the
 * organization they belong to — and the rollup itself is further narrowed to
 * the projects that caller can actually reach, which the port resolves because
 * membership is the process's fact rather than this feature's.
 *
 * Transport only: gate, input parsing and delegation to the process's spend
 * reader.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  TRPCError,
  type AnyTRPCRootTypes,
  type TRPCRootObject,
  type TRPCRuntimeConfigOptions,
} from "@trpc/server";
import { z } from "zod";

/** The process supplies authentication; authorization arrives as `policy`. */
export type CostTrpcContext = Readonly<{
  session: Readonly<{ user: Readonly<{ id: string }> }> | null;
}>;

type CostTrpcProcedures<
  TContext extends CostTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * The process's tracing, logging, error, scope-lineage, authorization and
   * audit policy for one declared permission.
   *
   * Applied by this feature AFTER its own input parser rather than composed
   * ahead of it, because the authorization check reads its scope id from the
   * validated input: tRPC runs middlewares in the order they were added, so a
   * check installed before `.input()` would see no input at all.
   */
  policy(permission: AuthzPermission): <TProcedure>(procedure: TProcedure) => TProcedure;
}>;

/**
 * The process capability this transport needs, which is not entitlement's own.
 *
 * The rollup reads the `Cost` table and the project rows beside it, and it is
 * narrowed by the caller's own membership — an organization admin sees every
 * project, everybody else sees the ones their teams hold. Which columns carry
 * that membership is the process's fact, so the whole read is a port and the
 * rollup shape it answers with is a type parameter: that shape is what the
 * billing screen renders, and a port answering `unknown` would hand the screen
 * `unknown`.
 */
export type CostTrpcPorts<TRollup> = Readonly<{
  readOrganizationSpend(input: {
    organizationId: string;
    userId: string;
    startDate: number;
    endDate: number;
  }): Promise<TRollup[]>;
}>;

const aggregatedCostsInputSchema = z.object({
  organizationId: z.string(),
  startDate: z.number(),
  endDate: z.number(),
});

/**
 * An end date inside the last hour means "up to now" — the caller's clock was
 * read when the screen rendered and rows have landed since.
 */
const RECENT_WINDOW_MS = 1000 * 60 * 60;

/** Installs the complete `costs.*` tRPC surface on a process-owned root. */
export class CostTrpcApi {
  static create<
    TContext extends CostTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
    TRollup,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: CostTrpcProcedures<TContext, TOptions, TRoot>,
    ports: CostTrpcPorts<TRollup>,
  ) {
    const { protected: procedure, policy } = procedures;

    return trpc.router({
      getAggregatedCostsForOrganization: policy("organization:view")(
        procedure.input(aggregatedCostsInputSchema),
      ).query(async ({ input, ctx }) => {
        const user = ctx.session?.user;
        // `protectedProcedure` has already refused an anonymous caller; this
        // only narrows the type.
        if (!user) throw new TRPCError({ code: "UNAUTHORIZED" });

        const now = Date.now();
        const endDate = now - input.endDate < RECENT_WINDOW_MS ? now : input.endDate;

        return ports.readOrganizationSpend({
          organizationId: input.organizationId,
          userId: user.id,
          startDate: input.startDate,
          endDate,
        });
      }),
    });
  }
}
