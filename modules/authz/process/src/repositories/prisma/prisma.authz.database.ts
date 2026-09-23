type PostgresAuthzDelegate = {
  findFirst?(args: unknown): Promise<unknown>;
  findUnique?(args: unknown): Promise<unknown>;
  findMany?(args: unknown): Promise<unknown[]>;
  count?(args: unknown): Promise<number>;
  create?(args: unknown): Promise<unknown>;
  createMany?(args: unknown): Promise<unknown>;
  update?(args: unknown): Promise<unknown>;
  updateMany?(args: unknown): Promise<unknown>;
  deleteMany?(args: unknown): Promise<unknown>;
  upsert?(args: unknown): Promise<unknown>;
};

/**
 * Structural database surface accepted at the application composition root.
 * Concrete repository requirements remain private to the adapter build.
 */
export abstract class PostgresAuthzDatabase {
  abstract readonly apiKey: PostgresAuthzDelegate;
  abstract readonly auditLog: PostgresAuthzDelegate;
  abstract readonly customRole: PostgresAuthzDelegate;
  abstract readonly grant: PostgresAuthzDelegate;
  abstract readonly grantUsage: PostgresAuthzDelegate;
  abstract readonly group: PostgresAuthzDelegate;
  abstract readonly groupMembership: PostgresAuthzDelegate;
  abstract readonly organization: PostgresAuthzDelegate;
  abstract readonly organizationInvite: PostgresAuthzDelegate;
  abstract readonly organizationUser: PostgresAuthzDelegate;
  abstract readonly project: PostgresAuthzDelegate;
  abstract readonly role: PostgresAuthzDelegate;
  abstract readonly roleBinding: PostgresAuthzDelegate;
  abstract readonly shareLink: PostgresAuthzDelegate;
  abstract readonly systemMigrationTenantState: PostgresAuthzDelegate;
  abstract readonly team: PostgresAuthzDelegate;
  abstract readonly teamUser: PostgresAuthzDelegate;
  abstract readonly user: PostgresAuthzDelegate;
  abstract readonly $transaction: (...args: any[]) => Promise<unknown>;
}
