/**
 * Opaque process-root database capability. The strict Prisma adapter performs
 * the runtime instance check, keeping generated Prisma out of this subpath's
 * public declarations while allowing composition to pass its configured client
 * without a type assertion.
 */
export type EventingProcessPersistenceDatabase = object;
