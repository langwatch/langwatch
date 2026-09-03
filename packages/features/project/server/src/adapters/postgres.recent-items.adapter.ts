/**
 * Process-composition adapter for the home screen's recent-activity strip.
 *
 * The strip is a read of the process's OWN audit trail — "what did this person
 * touch in this project" — followed by one lookup per entity it finds there, so
 * that a row can carry the name and the link the strip renders. Both halves are
 * Postgres and neither is anything the project service owns, which is why this
 * builds the service rather than the project adapter doing it.
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
    return new RecentItemsService(new PrismaRecentItemsRepository(this.database));
  }
}
