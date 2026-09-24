import { createLogger } from "@langwatch/observability";

import {
  type LangevalsCallKind,
  type LangevalsChannel,
  type LangevalsPayloadStaging,
  type LangevalsPost,
  type LangevalsPostConfig,
  PayloadTooLargeError,
  STAGED_PAYLOAD_HEADER,
} from "../langevals.channel.ts";

const logger = createLogger("langwatch:langevals:stagedFetch");

const STAGING_PREFIX = "langevals-staging";

/** The host only: a presigned URL carries its signature in the query string. */
function safeUrlHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "<invalid-url>";
  }
}

function maxBytesForKind(kind: LangevalsCallKind, config: LangevalsPostConfig): number {
  switch (kind) {
    case "evaluation":
      return config.evaluationMaxPayloadBytes;
    case "topic_clustering_batch":
    case "topic_clustering_incremental":
      return config.topicClusteringMaxPayloadBytes;
  }
}

/** A port of main's `stagedLangevalsFetch` (`server/langevals/stagedFetch.ts`). */
export class HttpLangevalsChannel implements LangevalsChannel {
  static create(input: {
    config: LangevalsPostConfig;
    staging: LangevalsPayloadStaging;
  }): HttpLangevalsChannel {
    return new HttpLangevalsChannel(input.config, input.staging);
  }

  private constructor(
    private readonly config: LangevalsPostConfig,
    private readonly staging: LangevalsPayloadStaging,
  ) {}

  async post(input: LangevalsPost): Promise<Response> {
    const { url, body, projectId, kind, headers = {}, signal } = input;
    const serialized = Buffer.from(JSON.stringify(body), "utf-8");
    const bytes = serialized.byteLength;
    const limit = maxBytesForKind(kind, this.config);
    const threshold = this.config.stagingThresholdBytes;

    if (bytes > limit) {
      logger.error(
        { projectId, kind, bytes, limitBytes: limit, url },
        "langevals payload exceeds configured hard cap, rejecting before any network call",
      );
      throw new PayloadTooLargeError({ bytes, limitBytes: limit, kind });
    }

    if (threshold === undefined || bytes <= threshold || projectId === undefined) {
      logger.debug(
        { projectId, kind, bytes, thresholdBytes: threshold, url },
        threshold === undefined
          ? "posting langevals payload inline (staging disabled)"
          : "posting langevals payload inline (below staging threshold)",
      );
      // Content-Type is pinned last so a caller cannot override it.
      return fetch(url, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: serialized,
        ...(signal ? { signal } : {}),
      });
    }

    const ttlSeconds = this.config.stagingTtlSeconds;
    const staged = await this.staging.stage({
      projectId,
      keyPrefix: `${STAGING_PREFIX}/${projectId}/${kind}`,
      serialized,
      ttlSeconds,
      ...(signal ? { signal } : {}),
    });

    logger.info(
      {
        projectId,
        kind,
        bytes,
        thresholdBytes: threshold,
        limitBytes: limit,
        ttlSeconds,
        stagedUrlHost: safeUrlHost(staged.url),
        target: url,
      },
      "staged large langevals payload via presigned S3 URL",
    );

    try {
      // Caller headers first, so the staged header and Content-Type cannot be overridden.
      return await fetch(url, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
          [STAGED_PAYLOAD_HEADER]: staged.url,
        },
        ...(signal ? { signal } : {}),
      });
    } finally {
      // Staged bodies carry trace data and provider credentials; langevals has read it by now.
      await staged.discard();
    }
  }
}
