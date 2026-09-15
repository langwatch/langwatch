/**
 * Calling convention for tenancy and mass-delete guards. Adapted to Prisma 7's query extensions
 * while keeping the (params, next) shape guards expect.
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
