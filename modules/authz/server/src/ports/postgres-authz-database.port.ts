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
export abstract class PostgresAuthzDatabasePort {
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
  abstract readonly $transaction: (...args: any[]) => Promise<any>;
}
