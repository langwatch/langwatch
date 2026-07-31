/**
 * LWQL tRPC transport.
 *
 * Issue #6346 decision 5: the sibling of `app/api/query`. Both call the same
 * `LwqlService`, so the UI cannot be permitted something the REST API forbids —
 * or the reverse, which is how a query surface grows two different answers to
 * "may I read this".
 *
 * Read-only surfaces are declared as `query`, not `mutation`. The #5670 spike
 * declared its read path as a mutation; that is a defect to correct rather than
 * a pattern to copy.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import {
  describeCatalogue,
  getLwqlService,
  LwqlError,
  lwqlQuerySchema,
} from "~/server/app-layer/lwql";

import { checkProjectPermission } from "../rbac";

const requestInput = z.object({
  projectId: z.string(),
  query: z.string().max(8000).optional(),
  ir: lwqlQuerySchema.optional(),
});

/**
 * Surfaces the error code and fix hint to the client.
 *
 * `BAD_REQUEST` is correct for every `LwqlError`: each one means the caller's
 * query was rejected, including `content_gated` — the plan does not permit the
 * query as written, which the hint explains.
 */
const toTrpcError = (error: unknown): never => {
  if (error instanceof LwqlError) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: error.hint ? `${error.message} ${error.hint}` : error.message,
      cause: error,
    });
  }
  throw error;
};

export const lwqlRouter = createTRPCRouter({
  run: protectedProcedure
    .input(requestInput)
    .use(checkProjectPermission("traces:view"))
    .query(async ({ input }) => {
      try {
        return await getLwqlService().run(
          { query: input.query, ir: input.ir },
          {
            projectId: input.projectId,
            // `explain` stays off here too. The UI is not an internal caller;
            // exposing generated SQL through it would put the plan-gated
            // schema in front of every logged-in user.
            explain: false,
          },
        );
      } catch (error) {
        return toTrpcError(error);
      }
    }),

  /** Compile without executing — powers inline editor validation. */
  validate: protectedProcedure
    .input(requestInput)
    .use(checkProjectPermission("traces:view"))
    .query(async ({ input }) => {
      try {
        const result = await getLwqlService().run(
          { query: input.query, ir: input.ir },
          { projectId: input.projectId, dryRun: true },
        );
        return { valid: true as const, columns: result.meta.columns };
      } catch (error) {
        if (error instanceof LwqlError) {
          return { valid: false as const, error: error.toJSON() };
        }
        throw error;
      }
    }),

  /**
   * The queryable surface, for autocomplete and the docs drawer. Contains no
   * tenant data, but stays behind the same permission as the data it describes.
   */
  catalogue: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("traces:view"))
    .query(() => ({ entities: describeCatalogue() })),
});
