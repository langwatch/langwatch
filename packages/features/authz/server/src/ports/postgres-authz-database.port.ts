type PostgresAuthzDelegate = {
  findFirst?(args: unknown): Promise<any>;
  findUnique?(args: unknown): Promise<any>;
  findMany?(args: unknown): Promise<any[]>;
  count?(args: unknown): Promise<number>;
  create?(args: unknown): Promise<any>;
  createMany?(args: unknown): Promise<any>;
  update?(args: unknown): Promise<any>;
  updateMany?(args: unknown): Promise<any>;
  deleteMany?(args: unknown): Promise<any>;
  upsert?(args: unknown): Promise<any>;
};

/**
 * Structural database surface accepted at the application composition root.
 * Concrete repository requirements remain private to the adapter build.
 */
export type PostgresAuthzDatabase = Readonly<{
  apiKey: PostgresAuthzDelegate;
  auditLog: PostgresAuthzDelegate;
  customRole: PostgresAuthzDelegate;
  grant: PostgresAuthzDelegate;
  grantUsage: PostgresAuthzDelegate;
  group: PostgresAuthzDelegate;
  groupMembership: PostgresAuthzDelegate;
  organization: PostgresAuthzDelegate;
  organizationInvite: PostgresAuthzDelegate;
  organizationUser: PostgresAuthzDelegate;
  project: PostgresAuthzDelegate;
  role: PostgresAuthzDelegate;
  roleBinding: PostgresAuthzDelegate;
  shareLink: PostgresAuthzDelegate;
  systemMigrationTenantState: PostgresAuthzDelegate;
  team: PostgresAuthzDelegate;
  teamUser: PostgresAuthzDelegate;
  user: PostgresAuthzDelegate;
  $transaction: (...args: any[]) => Promise<any>;
}>;
