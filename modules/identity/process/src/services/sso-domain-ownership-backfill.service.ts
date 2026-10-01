import type { SsoDomainOwnershipRepository } from "../repositories/sso-domain-ownership.repository.ts";

export interface SsoDomainOwnershipRefusal {
  connectionId: string;
  reason: string;
}

/** One organization's connections, re-derived one by one: a conflicting domain holds back only
 *  its own connection. */
export class SsoDomainOwnershipBackfillService {
  static create(ownership: SsoDomainOwnershipRepository): SsoDomainOwnershipBackfillService {
    return new SsoDomainOwnershipBackfillService(ownership);
  }

  private constructor(private readonly ownership: SsoDomainOwnershipRepository) {}

  async backfillOrganization({
    organizationId,
    signal,
  }: {
    organizationId: string;
    signal?: AbortSignal;
  }): Promise<{ connections: number; refused: SsoDomainOwnershipRefusal[] }> {
    const connectionIds = await this.ownership.findConnectionIds({ organizationId });
    const refused: SsoDomainOwnershipRefusal[] = [];
    for (const connectionId of connectionIds) {
      signal?.throwIfAborted();
      try {
        await this.ownership.reproject({ connectionId });
      } catch (error) {
        refused.push({
          connectionId,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { connections: connectionIds.length, refused };
  }
}
