/**
 * The model-provider capabilities that reach OUTSIDE this process.
 */
import {
  AiCallFailureService,
  CodexAccountService,
  HttpModelProviderCredentialProbeAdapter,
  ModelCostPreviewService,
  ModelCostRegexSafetyService,
  ModelLimitsService,
  SsrfModelProviderEgressAdapter,
  type ModelCostPreviewSpanReader,
  type ModelProviderEgressPolicy,
  type LlmModelCostTrpcPorts,
  type ModelProviderTrpcPorts,
  type TranslateTrpcPorts,
} from "@langwatch/model-provider-server";
import { HandledError } from "@langwatch/handled-error";
import { ApiModelProviderHostPort } from "../features/model-provider/model-provider.composition";

/** Everything the outbound half is composed from. */
export type ApiModelProviderHostOptions = Readonly<{
  /**
   * The address policy every probe is fenced by — the same one the gateway's
   * own stored-credential probe runs behind, so a caller cannot reach an
   * address through the "test this key" form that the gateway would refuse.
   */
  egress: ModelProviderEgressPolicy;
  /**
   * The process configuration a system provider's fallback credential is read
   * from. Passed rather than read here: a composition is this process's only
   * environment reader.
   */
  environment: Readonly<Record<string, string | undefined>>;
  /** Names this process in a refusal. */
  processName: string;
}>;

/** Composes the outbound half over this process's egress fence. */
export function composeApiModelProviderHost(
  options: ApiModelProviderHostOptions,
): ApiModelProviderHostPort {
  return ApiComposedModelProviderHost.create(options);
}

class ApiComposedModelProviderHost extends ApiModelProviderHostPort {
  static create(options: ApiModelProviderHostOptions): ApiComposedModelProviderHost {
    return new ApiComposedModelProviderHost(options);
  }

  private readonly codex = new CodexAccountService();

  private constructor(private readonly options: ApiModelProviderHostOptions) {
    super();
  }

  /**
   * The fence, built once per call rather than held. It carries no connection: it is the
   * address policy applied to `fetch`, and the probe adapter reads the policy through it.
   * Holding one would suggest a pool that does not exist.
   */
  private egress() {
    return SsrfModelProviderEgressAdapter.create({ policy: this.options.egress });
  }

  probes(): Pick<
    ModelProviderTrpcPorts,
    | "validateProviderApiKey"
    | "validateKeyWithCustomUrl"
    | "startCodexDeviceSignIn"
    | "pollCodexDeviceSignIn"
  > {
    return {
      validateProviderApiKey: (provider, customKeys) =>
        HttpModelProviderCredentialProbeAdapter.validateProviderApiKey(
          provider,
          customKeys,
          this.egress(),
        ),
      validateKeyWithCustomUrl: (input) =>
        HttpModelProviderCredentialProbeAdapter.validateKeyWithCustomUrl({
          ...input,
          environment: this.options.environment,
          egress: this.egress(),
        }),
      startCodexDeviceSignIn: () => this.codex.startDeviceSignIn(),
      pollCodexDeviceSignIn: (input) => this.codex.pollDeviceSignIn(input),
    };
  }

  costRules(): LlmModelCostTrpcPorts {
    const processName = this.options.processName;
    const regexSafety = ModelCostRegexSafetyService.create();
    const modelLimits = ModelLimitsService.create();
    const preview = ModelCostPreviewService.create({ regexSafety });
    return {
      isSafeRegex: (pattern) => regexSafety.isSafeRegex(pattern),
      tryGetModelLimits: (model) => modelLimits.tryGetModelLimits(model),
      previewMatchingSpans: ({ spans, input }) => {
        // The reader is the trace read stack's, carried through the application as an
        // opaque handle: only a process that composed one knows its concrete type, and a
        // process that composed none must say so rather than answering "no matching
        // spans" — a preview that invented an empty result would talk somebody out of a
        // rule that works.
        if (!isPreviewSpanReader(spans)) {
          return Promise.reject(new ApiCostPreviewUnavailableError(processName));
        }
        return preview.previewCostRuleMatchingSpans({ spans, input });
      },
    };
  }

  translate(): TranslateTrpcPorts {
    const failures = AiCallFailureService.create();
    return { wrapAiCall: (feature, call) => failures.wrapAiCall(feature, call) };
  }
}

/** Whether the application's opaque span handle answers the two preview reads. */
function isPreviewSpanReader(spans: unknown): spans is ModelCostPreviewSpanReader {
  const candidate = spans as Partial<ModelCostPreviewSpanReader> | null | undefined;
  return (
    typeof candidate?.getModelUsageStats === "function" &&
    typeof candidate?.getRecentSpansByModels === "function"
  );
}

/** The preview was asked for on a process that composed no span reader. */
class ApiCostPreviewUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(processName: string) {
    super("service_unavailable", "This part of the product is not available on this deployment", {
      httpStatus: 503,
      fault: "platform",
      meta: { process: processName, capability: "the cost rule's span preview" },
    });
    this.name = "ApiCostPreviewUnavailableError";
  }
}
