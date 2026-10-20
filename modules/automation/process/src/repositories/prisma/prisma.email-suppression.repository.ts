import {
  emailSuppressionSchema,
  type EmailSuppression,
  type EmailSuppressionCursor,
} from "@langwatch/automation-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import { EmailSuppressionRepository } from "../email-suppression.repository.ts";
const map = (row: unknown): EmailSuppression => emailSuppressionSchema.parse(row);
/**
 * Only what this repository touches, so composition names the slice it needs
 * rather than the whole generated client.
 */
type EmailSuppressionDatabase = Pick<PrismaClient, "emailSuppression">;

export class PrismaEmailSuppressionRepository extends EmailSuppressionRepository {
  private constructor(private readonly database: EmailSuppressionDatabase) {
    super();
  }
  static create(database: EmailSuppressionDatabase): PrismaEmailSuppressionRepository {
    return new PrismaEmailSuppressionRepository(database);
  }
  async findAll(input: { projectId: string }): Promise<EmailSuppression[]> {
    return (
      await this.database.emailSuppression.findMany({
        where: input,
        orderBy: { createdAt: "desc" },
      })
    ).map(map);
  }
  async findPage(input: {
    projectId: string;
    limit: number;
    cursor: EmailSuppressionCursor | null;
  }): Promise<EmailSuppression[]> {
    const { projectId, limit, cursor } = input;
    return (
      await this.database.emailSuppression.findMany({
        where: {
          projectId,
          // `createdAt` alone is not unique, so the id breaks the tie or a
          // page boundary inside a burst of equal timestamps skips rows.
          ...(cursor
            ? {
                OR: [
                  { createdAt: { lt: cursor.createdAt } },
                  { createdAt: cursor.createdAt, id: { lt: cursor.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit,
      })
    ).map(map);
  }
  async findMatching(input: { projectId: string; triggerId: string }): Promise<EmailSuppression[]> {
    return (
      await this.database.emailSuppression.findMany({
        where: {
          projectId: input.projectId,
          OR: [{ triggerId: null }, { triggerId: input.triggerId }],
        },
      })
    ).map(map);
  }
  async create(input: {
    projectId: string;
    email: string;
    triggerId: string | null;
    reason: string;
  }): Promise<EmailSuppression> {
    try {
      return map(await this.database.emailSuppression.create({ data: input }));
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (code !== "P2002") throw error;
      const existing = await this.database.emailSuppression.findFirst({
        where: input,
      });
      if (existing === null) throw error;
      return map(existing);
    }
  }
  async delete(input: { id: string; projectId: string }): Promise<void> {
    await this.database.emailSuppression.deleteMany({ where: input });
  }
}
