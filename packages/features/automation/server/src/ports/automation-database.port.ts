/**
 * Narrow database capability accepted by the Postgres composition adapter.
 *
 * The generated Prisma client is deliberately not part of this port. The
 * process hands the adapter its already-created client structurally; only the
 * private Prisma repositories know the generated delegate details. Arguments
 * are intentionally object-shaped (rather than `unknown`) and every result
 * is normalized by its semantic repository before it reaches Automation.
 */
type DelegateCall<TResult> = {
  bivariant(args: Record<string, unknown>): Promise<TResult>;
}["bivariant"];

type RawQuery = <T>(strings: TemplateStringsArray, ...values: any[]) => Promise<T>;
type RawExecute = (strings: TemplateStringsArray, ...values: any[]) => Promise<number>;

type Delegate = {
  findFirst: DelegateCall<unknown | null>;
  findMany: DelegateCall<unknown[]>;
  create: DelegateCall<unknown>;
  update: DelegateCall<unknown>;
  delete: DelegateCall<unknown>;
  deleteMany: DelegateCall<{ count: number }>;
  createMany: DelegateCall<{ count: number }>;
  groupBy: DelegateCall<unknown[]>;
};

/** Process-owned persistence boundary used only by Automation's Prisma adapters. */
export abstract class AutomationDatabasePort {
  abstract readonly database: AutomationDatabase;
}

export type AutomationDatabase = {
  project: Pick<Delegate, "findFirst" | "findMany">;
  trigger: Pick<Delegate, "findFirst" | "findMany" | "create" | "update">;
  triggerSent: Delegate;
  emailSuppression: Pick<Delegate, "findFirst" | "findMany" | "create" | "deleteMany">;
  customGraph: Pick<Delegate, "findFirst" | "findMany"> & {
    findUnique: DelegateCall<unknown | null>;
  };
  webhookEndpointDelivery: Pick<Delegate, "create" | "findMany">;
  $queryRaw: RawQuery;
  $executeRaw: RawExecute;
};
