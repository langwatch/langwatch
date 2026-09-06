/**
 * Parks an oversized payload in one project's S3 bucket and hands back a
 * presigned GET URL. The presign is S3-specific, so it lives with the rest of
 * this feature's S3 access rather than in the features that stage.
 */
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import type { S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Logger } from "@langwatch/observability";
import { PayloadStagingPort, type StagedPayload } from "../ports/payload-staging.port.ts";

/** Which bucket, on which connection, one project's staged bodies belong in. */
export type PayloadStagingS3Target = Readonly<{ bucket: string; client: S3Client }>;

export abstract class PayloadStagingS3TargetPort {
  abstract resolve(projectId: string): Promise<PayloadStagingS3Target>;
}

export class S3PayloadStagingAdapter extends PayloadStagingPort {
  static create(options: {
    targets: PayloadStagingS3TargetPort;
    logger?: Pick<Logger, "debug" | "warn">;
    /** Injected so the object name is deterministic under test. */
    uniqueSuffix?: () => string;
  }): S3PayloadStagingAdapter {
    return new S3PayloadStagingAdapter(
      options.targets,
      options.logger,
      options.uniqueSuffix ?? defaultUniqueSuffix,
    );
  }

  private constructor(
    private readonly targets: PayloadStagingS3TargetPort,
    private readonly logger: Pick<Logger, "debug" | "warn"> | undefined,
    private readonly uniqueSuffix: () => string,
  ) {
    super();
  }

  async stage(input: {
    projectId: string;
    keyPrefix: string;
    serialized: Buffer;
    ttlSeconds: number;
    signal?: AbortSignal | undefined;
  }): Promise<StagedPayload> {
    const { bucket, client } = await this.targets.resolve(input.projectId);
    const key = `${input.keyPrefix}/${this.uniqueSuffix()}.json`;

    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: input.serialized,
        ContentType: "application/json",
      }),
      input.signal ? { abortSignal: input.signal } : undefined,
    );
    this.logger?.debug(
      { projectId: input.projectId, bucket, key, bytes: input.serialized.byteLength },
      "staged an oversized payload in object storage",
    );

    const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
      expiresIn: input.ttlSeconds,
    });

    return {
      url,
      discard: async () => {
        try {
          await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
        } catch (error) {
          // Non-fatal: the bucket's lifecycle rule on the staging prefix is
          // the orphan fallback, and failing the call the payload was staged
          // for would turn a tidy-up miss into a customer-visible failure.
          this.logger?.warn(
            { projectId: input.projectId, bucket, key, error },
            "failed to discard a staged payload; the lifecycle rule will reap it",
          );
        }
      },
    };
  }
}

function defaultUniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}
