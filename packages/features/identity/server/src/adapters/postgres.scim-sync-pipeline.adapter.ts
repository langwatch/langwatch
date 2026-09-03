import { ScimSyncGuards } from "../scim-sync-guards";
import { createScimSyncPipeline, type ScimSyncPipeline } from "./scim-sync-pipeline-definition.adapter";
import { PrismaScimSyncProjectionRepository } from "../repositories/prisma/prisma.scim-sync-projection.repository";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

/** The one model the directory-sync ledger reads and writes. */
export type ScimSyncPipelineDatabase = PrismaClient;

export type PostgresScimSyncPipelineOptions = {
  /** The composition root's own typed client, handed down with no cast. */
  database: ScimSyncPipelineDatabase;
};

/**
 * The Postgres composition seam for the directory-sync pipeline (D08).
 *
 * ONE repository, in both roles. The fold's store and the guards' read are
 * the same `ScimSyncState` rows, so composing them separately would be two
 * objects that must agree about a JSON column and eventually would not — and
 * the column they would disagree about is `deadLetters`, which is the record
 * of what a directory was told it could stop retrying.
 */
export class PostgresScimSyncPipelineAdapter {
  static create(options: PostgresScimSyncPipelineOptions): PostgresScimSyncPipelineAdapter {
    return new PostgresScimSyncPipelineAdapter(options);
  }

  private constructor(private readonly options: PostgresScimSyncPipelineOptions) {}

  build(): ScimSyncPipeline {
    const projection = new PrismaScimSyncProjectionRepository(this.options.database);
    return createScimSyncPipeline({
      scimSyncProjectionStore: projection,
      scimSyncGuards: new ScimSyncGuards({ syncs: projection }),
    });
  }
}
