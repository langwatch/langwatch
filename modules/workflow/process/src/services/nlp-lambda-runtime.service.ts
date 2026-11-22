/**
 * Which Lambda a project is invoked on. A resolution is SHARED cluster-wide for
 * ten minutes and a cold burst collapses onto one; a failure is never cached.
 * @see specs/nlp-go/studio-lambda-cache.feature
 */
import type { Logger } from "@langwatch/observability";

import { type NlpLambdaArnCache } from "../app/workflow.app.ts";
import {
  type NlpLambdaArnResolver,
  type NlpLambdaArnEntry,
} from "../channels/nlp-lambda.channel.ts";

/** The shared key one project's ARN is filed under. */
export const NLP_LAMBDA_ARN_CACHE_PREFIX = "lambda_arn:";

/**
 * Long enough to absorb a minute-scale burst, short enough that out-of-band
 * drift — a console edit, a rebuilt image — heals inside the window.
 */
export const NLP_LAMBDA_ARN_CACHE_TTL_SECONDS = 600;

/** How long a function left unmoved for want of a usable order is served before a retry. */
export const NLP_LAMBDA_UNPROTECTED_ARN_CACHE_TTL_SECONDS = 60;

export class NlpLambdaRuntimeService {
  static create(options: {
    cache: NlpLambdaArnCache;
    resolver: NlpLambdaArnResolver;
    /** This deployment's engine image. A change invalidates every entry. */
    imageUri: string;
    /** Where that image sits in rollout order; an entry from a later one still holds. */
    imageOrder?: number | undefined;
    /** This deployment's function configuration. A change invalidates every entry. */
    configFingerprint: string;
    ttlSeconds?: number;
    logger?: Pick<Logger, "warn">;
  }): NlpLambdaRuntimeService {
    return new NlpLambdaRuntimeService(options);
  }

  private readonly inFlight = new Map<string, Promise<string>>();

  private constructor(
    private readonly options: {
      cache: NlpLambdaArnCache;
      resolver: NlpLambdaArnResolver;
      imageUri: string;
      imageOrder?: number | undefined;
      configFingerprint: string;
      ttlSeconds?: number;
      logger?: Pick<Logger, "warn">;
    },
  ) {}

  /** The function this project's engine answers on. */
  async resolveArn(projectId: string): Promise<string> {
    const shared = await this.tryReadShared(projectId);
    if (shared) {
      return shared;
    }

    const running = this.inFlight.get(projectId);
    if (running) {
      return running;
    }

    const resolution = this.resolveAndShare(projectId).finally(() => {
      this.inFlight.delete(projectId);
    });
    this.inFlight.set(projectId, resolution);

    return resolution;
  }

  private keyFor(projectId: string): string {
    return `${NLP_LAMBDA_ARN_CACHE_PREFIX}${projectId}`;
  }

  /** An unreadable or unparseable entry is a MISS, never a failure. */
  private async tryReadShared(projectId: string): Promise<string | null> {
    const key = this.keyFor(projectId);
    let raw: string | null;
    try {
      raw = await this.options.cache.find(key);
    } catch (error) {
      this.options.logger?.warn({ error, projectId }, "shared NLP Lambda ARN cache is unreadable");

      return null;
    }

    if (raw === null) {
      return null;
    }

    const entry = NlpLambdaRuntimeService.parseEntry(raw);
    if (!entry) {
      return null;
    }

    const { imageUri, imageOrder, configFingerprint } = this.options;
    // A newer release resolved it, and this pod's resolver would leave the
    // function as it is: re-resolving only churns the entry every pod shares.
    if (
      imageOrder !== undefined &&
      entry.imageOrder !== undefined &&
      entry.imageOrder > imageOrder
    ) {
      return entry.arn;
    }

    if (entry.imageUri !== imageUri || entry.configFingerprint !== configFingerprint) {
      // Removed rather than left to expire: the stale ARN is the answer every
      // other pod would keep serving for the rest of the window.
      await this.forget(key, projectId);

      return null;
    }

    return entry.arn;
  }

  private async resolveAndShare(projectId: string): Promise<string> {
    const { imageUri, configFingerprint } = this.options;
    const resolved = await this.options.resolver.resolve({ projectId, imageUri });
    // Filed under what the function carries, which is a newer release's image
    // when this pod's resolver left it alone, so that entry does not read stale.
    const entry: NlpLambdaArnEntry = {
      arn: resolved.arn,
      imageUri: resolved.imageUri,
      configFingerprint,
      ...(resolved.imageOrder === undefined ? {} : { imageOrder: resolved.imageOrder }),
    };
    try {
      await this.options.cache.set({
        key: this.keyFor(projectId),
        value: JSON.stringify(entry),
        ttlSeconds: resolved.unprotected
          ? NLP_LAMBDA_UNPROTECTED_ARN_CACHE_TTL_SECONDS
          : (this.options.ttlSeconds ?? NLP_LAMBDA_ARN_CACHE_TTL_SECONDS),
      });
    } catch (error) {
      this.options.logger?.warn(
        { error, projectId },
        "could not share the resolved NLP Lambda ARN",
      );
    }

    return resolved.arn;
  }

  private async forget(key: string, projectId: string): Promise<void> {
    try {
      await this.options.cache.delete(key);
    } catch (error) {
      this.options.logger?.warn({ error, projectId }, "could not drop the stale NLP Lambda ARN");
    }
  }

  private static parseEntry(raw: string): NlpLambdaArnEntry | null {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null) {
        return null;
      }

      const { arn, imageUri, imageOrder, configFingerprint } = parsed as Record<string, unknown>;
      if (typeof arn !== "string" || arn === "") {
        return null;
      }

      if (typeof imageUri !== "string" || imageUri === "") {
        return null;
      }

      // An entry written before the fingerprint existed reads as a miss.
      if (typeof configFingerprint !== "string" || configFingerprint === "") {
        return null;
      }

      return {
        arn,
        imageUri,
        configFingerprint,
        ...(typeof imageOrder === "number" ? { imageOrder } : {}),
      };
    } catch {
      return null;
    }
  }
}
