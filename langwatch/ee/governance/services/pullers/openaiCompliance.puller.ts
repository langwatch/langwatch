// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * OpenAI Enterprise Compliance reference puller — built on top of
 * the S3PollingPullerAdapter with the bucket-shape locked to
 * OpenAI's documented compliance-export format. Customers enable
 * "OpenAI Compliance" with one click + provide AWS credentials for
 * the bucket they configured OpenAI to write to.
 *
 * OpenAI's enterprise compliance API drops NDJSON files with the
 * documented event shape:
 *   {
 *     "id": "evt-...",
 *     "object": "audit_log",
 *     "type": "completion",
 *     "user": { "email": "...", "id": "..." },
 *     "model": "gpt-...",
 *     "created_at": "ISO 8601",
 *     "tokens": { "input": N, "output": N },
 *     "cost": { "usd": F }
 *   }
 *
 * Spec: specs/ai-governance/puller-framework/copilot-studio-reference.feature
 *       (same lock-the-shape pattern; openai/claude follow as ⏳ rows)
 */
import {
  S3PollingPullerAdapter,
  type S3PollingConfig,
} from "./s3PollingPullerAdapter";
import type { PullResult, PullRunOptions } from "./pullerAdapter";

/**
 * Locked reference config for OpenAI's enterprise compliance dump.
 * Admins provide ONLY: bucket name + prefix + AWS credentials. The
 * parser + event mapping are frozen.
 *
 * Customers configure their bucket + prefix at create-time via the
 * admin UI; this constant captures the IMMUTABLE shape (parser,
 * eventMapping, schedule). Fields admins control land on
 * IngestionSource.parserConfig with `_overrides_` semantics that the
 * puller respects via the override below.
 */
export const OPENAI_COMPLIANCE_PULL_CONFIG: Omit<
  S3PollingConfig,
  "bucket" | "prefix" | "region"
> = {
  adapter: "s3_polling",
  parser: "ndjson",
  schedule: "*/15 * * * *",
  eventMapping: {
    source_event_id: "$.id",
    event_timestamp: "$.created_at",
    actor: "$.user.email",
    action: "$.type",
    target: "$.model",
    cost_usd: "$.cost.usd",
    tokens_input: "$.tokens.input",
    tokens_output: "$.tokens.output",
    extra: {
      user_id: "$.user.id",
      object: "$.object",
    },
  },
};

interface OpenAiAdminInput {
  bucket: string;
  prefix?: string;
  region: string;
}

export class OpenAiComplianceReferencePuller extends S3PollingPullerAdapter {
  override readonly id: string = "openai_compliance";

  /**
   * Admins control bucket + prefix + region; everything else is locked
   * to the OpenAI-documented shape. We pull those fields off the
   * caller-supplied config and graft them onto the locked reference.
   */
  override validateConfig(config: unknown): S3PollingConfig {
    const input = config as Partial<OpenAiAdminInput> | undefined;
    if (!input?.bucket) {
      throw new Error(
        "openai_compliance: pullConfig.bucket is required (the S3 bucket OpenAI writes to)",
      );
    }
    if (!input.region) {
      throw new Error("openai_compliance: pullConfig.region is required");
    }
    return super.validateConfig({
      ...OPENAI_COMPLIANCE_PULL_CONFIG,
      bucket: input.bucket,
      prefix: input.prefix ?? "",
      region: input.region,
    });
  }

  override async runOnce(
    options: PullRunOptions,
    config: S3PollingConfig,
  ): Promise<PullResult> {
    return super.runOnce(options, config);
  }
}
