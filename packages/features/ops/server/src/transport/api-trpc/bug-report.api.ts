/**
 * The support inbox, over the process's tRPC transport.
 *
 * Two reads. `getAll` pages the reports `langwatch report` and the MCP report
 * tool file against the product itself; `getById` opens one of them. Both are
 * back-office reads of the same shape as the SSO connection surface beside
 * them, and this is the operations feature's because the inbox IS a back-office
 * resource: its page shell already lives under `ops/backoffice`, and the staff
 * allow-list it is gated on is this package's own `isAdmin`.
 *
 * The gate is NOT an RBAC permission. A bug report carries no tenant — the
 * table has no organization, team or project column — so there is no scope an
 * id in the input could be checked at, and no organization role that could
 * grant the read. What decides it is whether the caller is on the LangWatch
 * staff list, and an impersonating operator is read as the operator: somebody
 * debugging a customer account is still staff. `noPermission` carries that as
 * a written reason the declaration sweep can read, rather than leaving the
 * surface merely unchecked.
 *
 * Every read is audit-logged before it is answered. Reports carry
 * reporter-submitted transcripts and contact addresses, so who opened the
 * inbox is itself a fact worth keeping — and the search TEXT never reaches the
 * audit row, because a contact search is an email address and audit rows
 * outlive the inbox.
 *
 * Transport only: the gate, the input shapes, the audit rows and delegation.
 * The reports themselves arrive through {@link BugReportTrpcPorts}.
 */
import { type AdminIdentity } from "@langwatch/ops-contract";
import {
  TRPCError,
  type AnyTRPCRootTypes,
  type TRPCRootObject,
  type TRPCRuntimeConfigOptions,
} from "@trpc/server";
import { z } from "zod";

/**
 * Why this surface checks no permission, in the words the declaration sweep
 * and any later reviewer read.
 *
 * Exported rather than written at the mount, because the reason is a fact
 * about the inbox and not about the process serving it: a bug report has no
 * tenant, so there is no scope to check and no role that could grant the read.
 * The process turns it into its own policy chain; the sentence travels with
 * the feature.
 */
export const BUG_REPORTS_NO_PERMISSION = {
  reason: "bug reports are filed by the session user about the app itself",
} as const;

/** The staff identity the admin allow-list is checked against. */
type StaffIdentity = Readonly<{ id: string; email?: string | null }>;

/**
 * The process supplies authentication and the staff list.
 *
 * `app.ops` is narrowed to the one method this surface calls. The process's
 * own value is an `OpsApp`, which answers `isAdmin` and roughly fifty other
 * things; naming the whole service here would make a process context that
 * carries anything less unassignable, and this surface reads none of the rest.
 */
export type BugReportTrpcContext = Readonly<{
  app: Readonly<{ ops: Readonly<{ isAdmin(identity: AdminIdentity): boolean }> }>;
  session: Readonly<{
    user: StaffIdentity & Readonly<{ impersonator?: StaffIdentity | null }>;
  }> | null;
}>;

/** One procedure, wrapped in the process's policy chain. */
type ProcedureDecorator = <TProcedure>(procedure: TProcedure) => TProcedure;

type BugReportTrpcProcedures<
  TContext extends BugReportTrpcContext,
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
  staffPolicy: ProcedureDecorator;
}>;

/** The process capabilities this transport needs that are not the inbox's own. */
export type BugReportTrpcPorts<TListing, TReport> = Readonly<{
  /**
   * One page of the inbox, newest first, with the total behind it. Never the
   * stored session transcript: the listing is a table, and the transcript is
   * only read when one report is opened.
   */
  getAll(
    input: Readonly<{ page: number; pageSize: number; search?: string | undefined }>,
  ): Promise<TListing>;
  /** One report in full, or null when no such report exists. */
  getById(input: Readonly<{ id: string }>): Promise<TReport | null>;
  /** The process's audit trail. */
  recordAudit(
    entry: Readonly<{
      userId: string;
      action: string;
      args?: Readonly<Record<string, unknown>>;
      targetKind: string;
      targetId?: string;
    }>,
  ): Promise<void>;
}>;

const getAllInputSchema = z.object({
  page: z.number().int().min(0).default(0),
  pageSize: z.number().int().min(1).max(100).default(50),
  search: z.string().max(200).optional(),
});

const getByIdInputSchema = z.object({ id: z.string() });

/** What every audited row on this surface points at. */
const TARGET_KIND = "bugReport";

/** Installs the complete `bugReports.*` tRPC surface on a process root. */
export class BugReportTrpcApi {
  static create<
    TContext extends BugReportTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
    TListing,
    TReport,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: BugReportTrpcProcedures<TContext, TOptions, TRoot>,
    ports: BugReportTrpcPorts<TListing, TReport>,
  ) {
    const { protected: procedure, staffPolicy } = procedures;

    /**
     * The operator, or a refusal.
     *
     * The CONSTRAINT rather than the type parameter: tRPC hands a resolver a
     * `Simplify<TContext>`, which satisfies the constraint but is not
     * assignable to `TContext` itself, and nothing here reads past it.
     *
     * An impersonating operator is read as the operator. A request with no
     * session cannot reach this — the process's authenticated procedure
     * refuses first — and is refused the same way if it ever does.
     */
    const requireStaff = (ctx: BugReportTrpcContext): StaffIdentity => {
      const user = ctx.session?.user;
      const staff = user?.impersonator ?? user;
      if (!staff || !ctx.app.ops.isAdmin(staff)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
      }
      return staff;
    };

    return trpc.router({
      getAll: staffPolicy(procedure.input(getAllInputSchema)).query(async ({ ctx, input }) => {
        const staff = requireStaff(ctx);
        await ports.recordAudit({
          userId: staff.id,
          action: "bugReports.getAll",
          // Never the raw search text: contact searches are email addresses,
          // and audit rows outlive the inbox.
          args: {
            page: input.page,
            pageSize: input.pageSize,
            hasSearch: Boolean(input.search),
          },
          targetKind: TARGET_KIND,
        });
        return ports.getAll(input);
      }),

      getById: staffPolicy(procedure.input(getByIdInputSchema)).query(async ({ ctx, input }) => {
        const staff = requireStaff(ctx);
        await ports.recordAudit({
          userId: staff.id,
          action: "bugReports.getById",
          targetKind: TARGET_KIND,
          targetId: input.id,
        });
        const report = await ports.getById(input);
        if (!report) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Report not found" });
        }
        return report;
      }),
    });
  }
}
