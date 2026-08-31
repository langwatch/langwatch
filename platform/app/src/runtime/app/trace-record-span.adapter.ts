import type { TenantId } from "@langwatch/eventing";
import type { DataPrivacyService } from "@langwatch/data-privacy-contract";
import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import type {
  OtlpInstrumentationScope,
  OtlpResource,
  OtlpSpan,
  NormalizedSpan,
  PIIRedactionLevel,
  TraceCanonicalisationService,
} from "@langwatch/trace-contract";
import {
  RecordSpanCommand,
  TraceSpanContentDropPort,
  TraceSpanCostEnrichmentPort,
  TraceSpanNormalizationPort,
  TraceSpanPiiRedactionPort,
  TraceSpanSpoolPort,
  TraceSpanTokenEstimationPort,
  type TraceSpanSpoolIdentity,
} from "@langwatch/trace-server";
import type { BlobStore } from "~/server/app-layer/traces/blob-store.service";
import { OtlpSpanCostEnrichmentService } from "~/server/app-layer/traces/span-cost-enrichment.service";
import { OtlpSpanPiiRedactionService } from "~/server/app-layer/traces/span-pii-redaction.service";
import { OtlpSpanTokenEstimationService } from "~/server/app-layer/traces/span-token-estimation.service";
import { SpanNormalizationPipelineService } from "@langwatch/trace-server";
import type { TokenizerClient } from "~/server/app-layer/clients/tokenizer/tokenizer.client";
import { applyOtlpSpanContentDropWithPolicy } from "~/server/data-privacy/applyOtlpSpanContentDrop";

class AppTraceSpanPiiRedactionAdapter extends TraceSpanPiiRedactionPort {
  private readonly service: OtlpSpanPiiRedactionService;

  constructor(service: OtlpSpanPiiRedactionService) {
    super();
    this.service = service;
  }

  async redact(
    span: OtlpSpan,
    resource: OtlpResource | null,
    level: PIIRedactionLevel,
    tenantId: TenantId,
  ): Promise<void> {
    await this.service.redactSpan(span, resource, level, tenantId);
  }
}

class AppTraceSpanCostEnrichmentAdapter extends TraceSpanCostEnrichmentPort {
  private readonly service: OtlpSpanCostEnrichmentService;

  private constructor(modelProviders: ModelProviderService) {
    super();
    this.service = new OtlpSpanCostEnrichmentService({
      getCustomModelCosts: async (projectId) => {
        const costs = await modelProviders.listCosts({ projectId });
        return costs.map((cost) => ({
          projectId,
          model: cost.model,
          regex: cost.regex,
          inputCostPerToken: cost.inputCostPerToken ?? void 0,
          outputCostPerToken: cost.outputCostPerToken ?? void 0,
          cacheReadCostPerToken: cost.cacheReadCostPerToken ?? void 0,
          cacheCreationCostPerToken: cost.cacheCreationCostPerToken ?? void 0,
          cacheCreation1hCostPerToken: cost.cacheCreation1hCostPerToken ?? void 0,
          scopeType: cost.scopeType,
          scopeId: cost.scopeId,
          createdAt: cost.createdAt,
          updatedAt: cost.updatedAt,
        }));
      },
    });
  }

  static create(modelProviders: ModelProviderService): AppTraceSpanCostEnrichmentAdapter {
    return new AppTraceSpanCostEnrichmentAdapter(modelProviders);
  }

  async enrich(span: OtlpSpan, tenantId: string): Promise<void> {
    await this.service.enrichSpan(span, tenantId);
  }
}

class AppTraceSpanTokenEstimationAdapter extends TraceSpanTokenEstimationPort {
  private readonly service: OtlpSpanTokenEstimationService;

  private constructor(featureFlags: FeatureFlagService, tokenizer: TokenizerClient) {
    super();
    this.service = new OtlpSpanTokenEstimationService({
      tokenizer,
      featureFlags,
    });
  }

  static create(
    featureFlags: FeatureFlagService,
    tokenizer: TokenizerClient,
  ): AppTraceSpanTokenEstimationAdapter {
    return new AppTraceSpanTokenEstimationAdapter(featureFlags, tokenizer);
  }

  async estimate(span: OtlpSpan, tenantId: string): Promise<void> {
    await this.service.estimateSpanTokens({ span, tenantId });
  }
}

class AppTraceSpanContentDropAdapter extends TraceSpanContentDropPort {
  private constructor(
    private readonly dataPrivacy: DataPrivacyService,
    private readonly nativePolicyEnforced: boolean,
  ) {
    super();
  }

  static create(
    dataPrivacy: DataPrivacyService,
    nativePolicyEnforced: boolean,
  ): AppTraceSpanContentDropAdapter {
    return new AppTraceSpanContentDropAdapter(dataPrivacy, nativePolicyEnforced);
  }

  async drop(span: OtlpSpan, projectId: string) {
    return await applyOtlpSpanContentDropWithPolicy({
      span,
      projectId,
      dataPrivacy: this.dataPrivacy,
      nativePolicyEnforced: this.nativePolicyEnforced,
    });
  }
}

export class AppTraceSpanNormalizationAdapter extends TraceSpanNormalizationPort {
  private readonly service: SpanNormalizationPipelineService;

  private constructor(canonicalisation: TraceCanonicalisationService) {
    super();
    this.service = new SpanNormalizationPipelineService(canonicalisation);
  }

  static create(canonicalisation: TraceCanonicalisationService): AppTraceSpanNormalizationAdapter {
    return new AppTraceSpanNormalizationAdapter(canonicalisation);
  }

  normalizeSpanReceived(
    tenantId: string,
    span: OtlpSpan,
    resource: OtlpResource | null,
    instrumentationScope: OtlpInstrumentationScope | null,
  ) {
    return this.service.normalizeSpanReceived(tenantId, span, resource, instrumentationScope);
  }

  enrichRagContextIds(span: NormalizedSpan): void {
    this.service.enrichRagContextIds(span);
  }
}

class AppTraceSpanSpoolAdapter extends TraceSpanSpoolPort {
  private constructor(private readonly blobStore: BlobStore) {
    super();
  }

  static create(blobStore: BlobStore): AppTraceSpanSpoolAdapter {
    return new AppTraceSpanSpoolAdapter(blobStore);
  }

  async read(identity: TraceSpanSpoolIdentity): Promise<string> {
    const body = await this.blobStore.getSpool(identity);
    return body.toString("utf8");
  }

  async delete(identity: TraceSpanSpoolIdentity): Promise<void> {
    await this.blobStore.deleteSpool(identity);
  }
}

/** App infrastructure for Trace's package-owned record command. */
export class AppTraceRecordSpanAdapter {
  private constructor() {}

  static create(options: {
    modelProviders: ModelProviderService;
    featureFlags: FeatureFlagService;
    piiRedaction: OtlpSpanPiiRedactionService;
    tokenizer: TokenizerClient;
    dataPrivacy: DataPrivacyService;
    nativePolicyEnforced: boolean;
    blobStore?: BlobStore;
  }): RecordSpanCommand {
    return RecordSpanCommand.create({
      piiRedaction: new AppTraceSpanPiiRedactionAdapter(options.piiRedaction),
      costEnrichment: AppTraceSpanCostEnrichmentAdapter.create(options.modelProviders),
      tokenEstimation: AppTraceSpanTokenEstimationAdapter.create(
        options.featureFlags,
        options.tokenizer,
      ),
      contentDrop: AppTraceSpanContentDropAdapter.create(
        options.dataPrivacy,
        options.nativePolicyEnforced,
      ),
      spool: options.blobStore ? AppTraceSpanSpoolAdapter.create(options.blobStore) : void 0,
    });
  }
}
