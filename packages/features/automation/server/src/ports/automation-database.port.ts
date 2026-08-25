/** Minimal Prisma-shaped capability consumed by the private persistence adapters.
 * Keeping this port structural means the feature never imports a process Prisma
 * singleton and can be composed against the app's typed client. */
export type AutomationDatabase = {
  project: { findFirst(args: unknown): Promise<unknown> };
  trigger: {
    findFirst(args: unknown): Promise<unknown>;
    findMany(args: unknown): Promise<unknown[]>;
    /** Cross-tenant report reconciliation is supplied by the host adapter. */
    findActiveReportTargets(): Promise<unknown[]>;
    create(args: unknown): Promise<unknown>;
    update(args: unknown): Promise<unknown>;
  };
  triggerSent: {
    create(args: unknown): Promise<unknown>;
    createMany(args: unknown): Promise<{ count: number }>;
    findFirst(args: unknown): Promise<unknown>;
    findMany(args: unknown): Promise<unknown[]>;
    groupBy(args: unknown): Promise<unknown[]>;
  };
  emailSuppression: {
    findFirst(args: unknown): Promise<unknown>;
    findMany(args: unknown): Promise<unknown[]>;
    create(args: unknown): Promise<unknown>;
    deleteMany(args: unknown): Promise<{ count: number }>;
  };
  customGraph: {
    findUnique(args: unknown): Promise<unknown>;
    findMany(args: unknown): Promise<unknown[]>;
  };
  webhookEndpointDelivery: {
    create(args: unknown): Promise<unknown>;
    findMany(args: unknown): Promise<unknown[]>;
  };
  /** System-owned maintenance query for the shared webhook delivery log. */
  $queryRaw<T>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<number>;
};
