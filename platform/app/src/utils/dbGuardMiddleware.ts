/**
 * The calling convention the tenancy / mass-delete guards use.
 *
 * Prisma 7 removed `$use` and its `Prisma.Middleware` / `Prisma.MiddlewareParams`
 * types. The guards keep the same `(params, next)` shape they always had — the
 * unit tests drive them directly with hand-built params — and `db.ts` adapts
 * them onto a client query extension (`$allModels.$allOperations` plus the raw
 * entries), which is the Prisma 7 replacement for `$use`.
 */
export interface GuardParams {
  /** Undefined for raw / model-less operations, exactly as under `$use`. */
  model?: string;
  /** The operation name: `findMany`, `create`, `queryRaw`, `executeRaw`, … */
  action: string;
  args: any;
}

export type GuardNext = (params: GuardParams) => Promise<unknown>;

export type GuardMiddleware = (params: GuardParams, next: GuardNext) => Promise<unknown>;
