import { createLogger, type Logger } from "@langwatch/observability";
import {
  StoredObjectNotFoundError,
  StoredObjectOwnerResolver,
} from "@langwatch/stored-object-contract";

/**
 * The legacy id-only owner lookup, unresolved. Resolving a project from an
 * object id alone means scanning every ClickHouse instance the deployment
 * operates; this process composes no such directory (tracked gap).
 */
export class StoredObjectOwnerUnresolvedService extends StoredObjectOwnerResolver {
  static create(
    input: Readonly<{ logger?: Pick<Logger, "warn"> }> = {},
  ): StoredObjectOwnerUnresolvedService {
    return new StoredObjectOwnerUnresolvedService(
      input.logger ?? createLogger("langwatch:stored-object"),
    );
  }

  private constructor(private readonly logger: Pick<Logger, "warn">) {
    super();
  }

  async getOwner(input: { id: string }): Promise<{ projectId: string }> {
    this.logger.warn(
      { storedObjectId: input.id },
      "API process composed no stored-object owner directory: an id-only stored-object reference cannot be resolved to a project here.",
    );
    throw new StoredObjectNotFoundError();
  }
}
