import { prismaRepositories } from "@langwatch/prisma-client";
import { PrismaStoredObjectRecordRepository } from "./prisma.stored-object-record.repository.ts";

export const PostgresStoredObjectRepositories = prismaRepositories({
  records: PrismaStoredObjectRecordRepository,
});
