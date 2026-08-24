import { PrismaDriverAdapterService } from "@langwatch/prisma-client";

/** @deprecated Compose Prisma through @langwatch/prisma-client instead. */
export function createPrismaPgAdapter(databaseUrl: string) {
  return PrismaDriverAdapterService.create().createOwnedAdapter(databaseUrl);
}

/** @deprecated Resolve pool configuration through the package service. */
export function pgPoolConfig(databaseUrl: string) {
  return PrismaDriverAdapterService.create().poolConfig(databaseUrl);
}
