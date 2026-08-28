import type { DataPrivacyService } from "@langwatch/data-privacy-contract";
import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import type { ProcessTokenizerClient } from "~/server/app-layer/clients/tokenizer/tokenizer.client";
import {
  AppPiiRedactionTransport,
  type PiiRedactionTransport,
} from "~/server/tracer/collector/piiCheck";
import { OtlpSpanPiiRedactionService } from "~/server/app-layer/traces/span-pii-redaction.service";
import type { TracePrivacyRuntimeConfig } from "~/runtime/trace-privacy.config";

/** One process-owned external privacy graph shared by Trace, logs and metrics. */
export class AppTracePrivacyRuntime {
  static create(options: {
    config: TracePrivacyRuntimeConfig;
    dataPrivacy: DataPrivacyService;
    featureFlags: FeatureFlagService;
    tokenizer: ProcessTokenizerClient;
  }): AppTracePrivacyRuntime {
    const transport = AppPiiRedactionTransport.create(options.config);
    const redaction = new OtlpSpanPiiRedactionService({
      transport,
      isLangevalsConfigured: Boolean(options.config.presidio.endpoint),
      isProduction: options.config.isProduction,
      nativePolicyEnforced: options.config.nativePolicyEnforced,
      piiRedactionMaxAttributeLength: 250_000,
      dataPrivacy: options.dataPrivacy,
      featureFlags: options.featureFlags,
    });
    return new AppTracePrivacyRuntime(
      transport,
      redaction,
      options.tokenizer,
      options.dataPrivacy,
      options.config.nativePolicyEnforced,
    );
  }

  private constructor(
    readonly transport: PiiRedactionTransport,
    readonly redaction: OtlpSpanPiiRedactionService,
    readonly tokenizer: ProcessTokenizerClient,
    readonly dataPrivacy: DataPrivacyService,
    readonly nativePolicyEnforced: boolean,
  ) {}

  async close(): Promise<void> {
    let firstFailure: unknown;
    try {
      await this.transport.close();
    } catch (error) {
      firstFailure = error;
    }
    try {
      await this.tokenizer.close();
    } catch (error) {
      firstFailure ??= error;
    }
    if (firstFailure) throw firstFailure;
  }
}
