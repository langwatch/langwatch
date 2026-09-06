/**
 * The two capabilities behind `httpProxy.*` that reach OUTSIDE this process: the
 * optimization studio's streaming dispatch, and the agent test's own trace write.
 */
import {
  buildAgentTestTrace,
  type AgentTestTrace,
  type HttpProxyTrpcPorts,
} from "@langwatch/agent-server";
import { HandledError } from "@langwatch/handled-error";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import { createLogger } from "@langwatch/observability";
import { TraceCollectorSpanService } from "@langwatch/trace-server";
import type { StudioClientEvent, StudioServerEvent } from "@langwatch/workflow-contract";
import {
  AwsNlpLambdaArnResolverAdapter,
  AwsNlpLambdaStreamInvokeAdapter,
  HttpWorkflowStudioStreamAdapter,
  InMemoryNlpLambdaArnCacheAdapter,
  LambdaWorkflowStudioStreamAdapter,
  NLP_LAMBDA_CONFIG_ENV,
  NlpLambdaArnCachePort,
  NlpLambdaFunctionPort,
  NlpLambdaRuntimeService,
  NlpPayloadStagingPort,
  UnconfiguredWorkflowStudioStreamAdapter,
  WorkflowStudioDispatchService,
  WorkflowStudioStreamPort,
  resolveStudioLambdaConfig,
  type StudioLambdaConfig,
} from "@langwatch/workflow-server";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { ApiStudioHostPort } from "../features/agent/http-proxy.composition.ts";

/** One command sender on the process's own eventing registration. */
export type ApiStudioTraceIngest = Readonly<{
  recordSpan(data: unknown): Promise<void>;
}>;

/** Everything the studio host is composed from. */
export type ApiStudioHostOptions = Readonly<{
  /** Where the NLP engine answers, or none where the process was given no address. */
  nlpServiceUrl: string | undefined;
  /** The gateway the sampling-parameter strip reads a project's models through. */
  modelProviders: ModelProviderService | undefined;
  /** The ingest queue an agent test's span is enqueued on, if one was composed. */
  traceIngest?: ApiStudioTraceIngest | undefined;
  /** Names a refusal, so a stand-in says which process reached it. */
  processName: string;
  /**
   * Where an oversized studio graph is parked while its invocation is in
   * flight. Only the Lambda path can need it; a process that composed no
   * object storage refuses an oversized run by name rather than posting over
   * Lambda's invoke cap.
   */
  payloadStaging?: NlpPayloadStagingPort | undefined;
  /**
   * Where a resolved function ARN is shared. A process with none resolves each
   * project once for itself, which is slower rather than wrong.
   */
  arnCache?: NlpLambdaArnCachePort | undefined;
  /**
   * Where the studio's Lambda fleet is described. The API's own configuration
   * projects only the three credential fields its cleanup cron reads, so the
   * execution half reads the whole `LANGWATCH_NLP_LAMBDA_CONFIG` shape through
   * the workflow feature's own sub-schema.
   */
  environment?: Readonly<Record<string, unknown>> | undefined;
}>;

/** Composes the studio host over this process's engine address and queue. */
export function composeApiStudioHost(options: ApiStudioHostOptions): ApiStudioHostPort {
  return ApiComposedStudioHost.create(options);
}

/**
 * The ONE place this process builds a studio dispatch.
 */
export function composeApiWorkflowStudioDispatch(options: {
  nlpServiceUrl: string | undefined;
  modelProviders: ModelProviderService;
  payloadStaging?: NlpPayloadStagingPort | undefined;
  arnCache?: NlpLambdaArnCachePort | undefined;
  environment?: Readonly<Record<string, unknown>> | undefined;
}): WorkflowStudioDispatchService {
  return WorkflowStudioDispatchService.create({
    stream: composeApiWorkflowStudioStream(options),
    modelProviders: options.modelProviders,
  });
}

/**
 * Which engine a studio run reaches, and on whose terms.
 *
 * A deployment that describes a per-project Lambda fleet runs every graph on
 * the project's own function, which is what the hosted product does; one that
 * names only an address runs them all at that address, which is what every
 * self-hosted install and local stack does. A fleet named but unusable is
 * NEITHER: falling back to the shared address there would answer a
 * misconfiguration with a quietly different deployment shape, so it refuses.
 */
export function composeApiWorkflowStudioStream(options: {
  nlpServiceUrl: string | undefined;
  payloadStaging?: NlpPayloadStagingPort | undefined;
  arnCache?: NlpLambdaArnCachePort | undefined;
  environment?: Readonly<Record<string, unknown>> | undefined;
}): WorkflowStudioStreamPort {
  const environment = options.environment ?? process.env;
  const fleet = resolveStudioLambdaConfig(environment);
  if (fleet) {
    return composeLambdaStudioStream({ fleet, ...options });
  }

  const named = environment[NLP_LAMBDA_CONFIG_ENV];
  if (typeof named === "string" && named.trim() !== "") {
    return MisconfiguredFleetStudioStreamAdapter.create();
  }

  return options.nlpServiceUrl
    ? HttpWorkflowStudioStreamAdapter.create({ serviceUrl: options.nlpServiceUrl })
    : UnconfiguredWorkflowStudioStreamAdapter.create();
}

/** The per-project fleet, from its credentials down to its shared ARN cache. */
function composeLambdaStudioStream(options: {
  fleet: StudioLambdaConfig;
  payloadStaging?: NlpPayloadStagingPort | undefined;
  arnCache?: NlpLambdaArnCachePort | undefined;
}): WorkflowStudioStreamPort {
  const { fleet } = options;
  const credentials = {
    accessKeyId: fleet.accessKeyId,
    secretAccessKey: fleet.secretAccessKey,
  };
  // Six attempts rather than the SDK's three: a fleet cold-starting on a fresh
  // image can spend a ~30-60s burst answering every control-plane call with a
  // rate limit, and three retries all land inside it.
  const lambda = new LambdaClient({ region: fleet.region, credentials, maxAttempts: 6 });
  const logger = createLogger("langwatch:api:studio-lambda");
  const runtime = NlpLambdaRuntimeService.create({
    cache: options.arnCache ?? InMemoryNlpLambdaArnCacheAdapter.create(),
    resolver: AwsNlpLambdaArnResolverAdapter.create({
      lambda,
      logs: new CloudWatchLogsClient({ region: fleet.region, credentials }),
      config: fleet,
      logger,
    }),
    imageUri: fleet.imageUri,
    logger,
  });

  return LambdaWorkflowStudioStreamAdapter.create({
    functions: new (class extends NlpLambdaFunctionPort {
      arnFor(input: { projectId: string }): Promise<string> {
        return runtime.resolveArn(input.projectId);
      }
    })(),
    invoke: AwsNlpLambdaStreamInvokeAdapter.create({ lambda }),
    staging: options.payloadStaging,
    stagingThresholdBytes: fleet.stagingThresholdBytes,
    stagingTtlSeconds: fleet.stagingTtlSeconds,
  });
}

/**
 * A studio Lambda fleet this deployment named but did not describe.
 *
 * Refuses by name: a half-written `LANGWATCH_NLP_LAMBDA_CONFIG` silently
 * served from the shared engine address instead runs every project's graph
 * somewhere the operator did not choose, and nothing in the product says so.
 */
class MisconfiguredFleetStudioStreamAdapter extends WorkflowStudioStreamPort {
  static create(): MisconfiguredFleetStudioStreamAdapter {
    return new MisconfiguredFleetStudioStreamAdapter();
  }

  private constructor() {
    super();
  }

  open(): Promise<ReadableStreamDefaultReader<Uint8Array>> {
    return Promise.reject(new ApiStudioLambdaFleetMisconfiguredError());
  }
}

class ApiComposedStudioHost extends ApiStudioHostPort {
  static create(options: ApiStudioHostOptions): ApiComposedStudioHost {
    return new ApiComposedStudioHost(options);
  }

  private readonly logger;
  private readonly dispatch: WorkflowStudioDispatchService | null;

  private constructor(private readonly options: ApiStudioHostOptions) {
    super();
    this.logger = createLogger(`${options.processName}:studio`);
    const modelProviders = options.modelProviders;
    this.dispatch = modelProviders
      ? composeApiWorkflowStudioDispatch({
          nlpServiceUrl: options.nlpServiceUrl,
          modelProviders,
          payloadStaging: options.payloadStaging,
          arnCache: options.arnCache,
          environment: options.environment,
        })
      : null;
  }

  ports(): HttpProxyTrpcPorts {
    return {
      postStudioEvent: (_request, input) => this.postStudioEvent(input),
      recordAgentTestTrace: (_request, input) => this.recordAgentTestTrace(input),
    };
  }

  /**
   * One studio event, dispatched and streamed back.
   */
  private postStudioEvent(
    input: Readonly<{
      projectId: string;
      event: StudioClientEvent;
      onEvent(event: StudioServerEvent): void;
    }>,
  ): Promise<void> {
    const dispatch = this.dispatch;
    if (!dispatch) {
      return Promise.reject(this.refuse("the studio event dispatch"));
    }
    return dispatch.postEvent({
      projectId: input.projectId,
      event: input.event,
      onEvent: input.onEvent,
    });
  }

  /**
   * The agent test's span, enqueued on the same ingest the collector drains. The span
   * arrives in LangWatch's own format because the feature built it that way; the queue
   * speaks OTLP, so it is converted here with the SAME converter the collector uses.
   */
  private async recordAgentTestTrace(
    input: Readonly<{ projectId: string; trace: AgentTestTrace }>,
  ): Promise<void> {
    const ingest = this.options.traceIngest;
    if (!ingest) {
      throw this.refuse("the agent test's trace write");
    }
    const trace = input.trace;
    await ingest.recordSpan({
      tenantId: input.projectId,
      span: TraceCollectorSpanService.convertSpanToOtlp(trace.span),
      resource: TraceCollectorSpanService.buildResource({
        reservedTraceMetadata: { user_id: trace.userId },
        customMetadata: trace.customMetadata,
      }),
      instrumentationScope: null,
      occurredAt: trace.occurredAt,
    });
    this.logger.debug(
      { projectId: input.projectId, traceId: trace.traceId },
      "agent test trace enqueued",
    );
  }

  private refuse(capability: string): Error {
    return new ApiStudioCapabilityUnavailableError(this.options.processName, capability);
  }
}

/** Re-exported so a host can build the trace an agent test writes. */
export { buildAgentTestTrace };

/** A studio Lambda fleet this deployment named but did not fully describe. */
class ApiStudioLambdaFleetMisconfiguredError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor() {
    super("service_unavailable", "This part of the product is not available on this deployment", {
      httpStatus: 503,
      fault: "platform",
      meta: { capability: "the studio's per-project execution fleet" },
    });
    this.name = "ApiStudioLambdaFleetMisconfiguredError";
  }
}

/** A studio capability this process did not compose, refused by name. */
class ApiStudioCapabilityUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(processName: string, capability: string) {
    super("service_unavailable", "This part of the product is not available on this deployment", {
      httpStatus: 503,
      fault: "platform",
      meta: { process: processName, capability },
    });
    this.name = "ApiStudioCapabilityUnavailableError";
  }
}
