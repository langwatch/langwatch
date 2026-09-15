import { S3Client } from "@aws-sdk/client-s3";
import type { ClickHouseClient } from "@clickhouse/client";
import { TraceBlobStoreService } from "@langwatch/trace-server";
import type { WorkerObjectStorage } from "./worker-object-storage.composition.ts";

/** Reads durable event references and legacy S3 spool references through tenant routing. */
export function createWorkerTraceBlobRead(options: {
  storage: WorkerObjectStorage;
  resolveClickHouseClient: (tenantId: string) => Promise<ClickHouseClient>;
}): TraceBlobStoreService {
  return TraceBlobStoreService.create({
    resolveClickHouseClient: options.resolveClickHouseClient,
    resolveS3Client: async (projectId) => {
      const target = (await options.storage.projects.tryGet(projectId)) ?? options.storage.globalS3;
      if (!target) {
        throw new Error(`Project ${projectId} has no S3 destination for its legacy trace spool.`);
      }

      return {
        s3Bucket: target.bucket,
        s3Client: new S3Client({
          ...options.storage.aws.build({
            region: target.region,
            targetHost: target.endpoint ?? "s3.amazonaws.com",
            endpoint: target.endpoint,
            staticCredentials: target.credentials,
          }),
          forcePathStyle: true,
        }),
      };
    },
  });
}
