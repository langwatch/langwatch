import { ScimSyncGuards } from "../scim-sync-guards";
import {
  ScimSyncPipelineDefinitionAdapter,
  type ScimSyncPipeline,
} from "./scim-sync-pipeline-definition.adapter";
import { PrismaScimSyncProjectionRepository } from "../repositories/prisma/prisma.scim-sync-projection.repository";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

/** The one model the directory-sync ledger reads and writes. */
export type ScimSyncPipelineDatabase = PrismaClient;

export type PostgresScimSyncPipelineOptions = {
  /** The composition root's own typed client, handed down with no cast. */
  database: ScimSyncPipelineDatabase;
};

/**
 * The Postgres composition seam for the directory-sync pipeline (D08). ONE repository, in both
 * roles.
 */
export class PostgresScimSyncPipelineAdapter {
  static create(options: PostgresScimSyncPipelineOptions): PostgresScimSyncPipelineAdapter {
    return new PostgresScimSyncPipelineAdapter(options);
  }

  private constructor(private readonly options: PostgresScimSyncPipelineOptions) {}

  build(): ScimSyncPipeline {
    const projection = new PrismaScimSyncProjectionRepository(this.options.database);
    return ScimSyncPipelineDefinitionAdapter.create({
      scimSyncProjectionStore: projection,
      scimSyncGuards: new ScimSyncGuards({ syncs: projection }),
    });
  }
}
