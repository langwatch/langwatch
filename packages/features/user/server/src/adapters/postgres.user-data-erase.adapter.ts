import type { GdprUserDataEraseDatabase } from "../repositories/prisma/prisma.user-data-erase.repository";
import { GdprUserDataEraseRepository } from "../repositories/prisma/prisma.user-data-erase.repository";

/** The Postgres seam for the GDPR erase walk's cross-tenant reads and deletes. */
export class PostgresUserDataEraseAdapter {
  static create(options: { database: GdprUserDataEraseDatabase }): GdprUserDataEraseRepository {
    return GdprUserDataEraseRepository.create({ database: options.database });
  }
}
