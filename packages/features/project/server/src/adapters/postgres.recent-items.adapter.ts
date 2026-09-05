/**
 * Process-composition adapter for the home screen's recent-activity strip.
 */
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { PrismaRecentItemsRepository } from "../repositories/prisma/prisma.recent-items.repository";
import { RecentItemsService } from "../services/recent-items.service";

export class PostgresRecentItemsAdapter {
  static create(options: { database: PrismaClient }): PostgresRecentItemsAdapter {
    return new PostgresRecentItemsAdapter(options.database);
  }

  private constructor(private readonly database: PrismaClient) {}

  build(): RecentItemsService {
    return RecentItemsService.create({
      repository: PrismaRecentItemsRepository.create({ prisma: this.database }),
    });
  }
}
