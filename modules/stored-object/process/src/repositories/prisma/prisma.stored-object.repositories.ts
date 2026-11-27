import { prismaRepositories } from "@langwatch/prisma-client";

import { PrismaStoredObjectOwnerLinkRepository } from "./prisma.stored-object-owner-link.repository.ts";
import { PrismaStoredObjectRecordRepository } from "./prisma.stored-object-record.repository.ts";

export const PostgresStoredObjectRepositories = prismaRepositories({
  records: PrismaStoredObjectRecordRepository,
  ownerLinks: PrismaStoredObjectOwnerLinkRepository,
});
