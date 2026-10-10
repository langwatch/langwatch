/**
 * Opaque process-root database capability, keeping generated Prisma out of
 * this subpath's public declarations; the strict Prisma adapter performs the
 * runtime instance check so composition needs no type assertion.
 */
export type EventingProcessPersistenceDatabase = object;
