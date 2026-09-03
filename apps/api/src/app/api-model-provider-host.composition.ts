/**
 * The model-provider capabilities that reach OUTSIDE this process.
 *
 * Four things sit here rather than in the gateway composition beside them,
 * because none of them is a row read: the vendor credential probes and the
 * Codex device flow open connections to somebody else's server, the cost-rule
 * span preview reads the trace store, and the translation wrapper is a failure
 * policy rather than a capability. The gateway is composed once and handed in;
 * what this adds is the outbound half of the provider surface.
 *
 * The regex safety gate is the one member that cannot degrade at call time —
 * the cost-rule write and preview SCHEMAS are built from it — so it is the
 * package's real `isSafeRegex` here rather than anything conservative.
 */
import {
  CodexAccountService,
  getModelLimits,
  HttpModelProviderCredentialProbeAdapter,
  isSafeRegex,
  previewCostRuleMatchingSpans,
  SsrfModelProviderEgressAdapter,
  validateKeyWithCustomUrl,
  validateProviderApiKey,
  wrapAiCall,
  type ModelCostPreviewSpanReader,
  type ModelProviderEgressPolicy,
  type LlmModelCostTrpcPorts,
  type ModelProviderTrpcPorts,
  type TranslateTrpcPorts,
} from "@langwatch/model-provider-server";
import { HandledError } from "@langwatch/handled-error";
import { ApiModelProviderHostPort } from "./api-trpc-collaborators.trace-group.composition";

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
   * The fence, built once per call rather than held.
   *
   * It carries no connection: it is the address policy applied to `fetch`, and
   * the probe adapter reads the policy through it. Holding one would suggest a
   * pool that does not exist.
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
        validateProviderApiKey(provider, customKeys, this.egress()),
      validateKeyWithCustomUrl: (input) =>
        validateKeyWithCustomUrl({
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
    return {
      isSafeRegex,
      getModelLimits,
      previewMatchingSpans: ({ spans, input }) => {
        // The reader is the trace read stack's, carried through the
        // application as an opaque handle: only a process that composed one
        // knows its concrete type, and a process that composed none must say
        // so rather than answering "no matching spans" — a preview that
        // invented an empty result would talk somebody out of a rule that
        // works.
        if (!isPreviewSpanReader(spans)) {
          return Promise.reject(new ApiCostPreviewUnavailableError(processName));
        }
        return previewCostRuleMatchingSpans({ spans, input });
      },
    };
  }

  translate(): TranslateTrpcPorts {
    return { wrapAiCall };
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
