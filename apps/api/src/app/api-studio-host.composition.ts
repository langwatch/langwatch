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
  HttpWorkflowStudioStreamAdapter,
  UnconfiguredWorkflowStudioStreamAdapter,
  WorkflowStudioDispatchService,
} from "@langwatch/workflow-server";
import { ApiStudioHostPort } from "../features/agent/http-proxy.composition";

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
}): WorkflowStudioDispatchService {
  return WorkflowStudioDispatchService.create({
    stream: options.nlpServiceUrl
      ? HttpWorkflowStudioStreamAdapter.create({ serviceUrl: options.nlpServiceUrl })
      : UnconfiguredWorkflowStudioStreamAdapter.create(),
    modelProviders: options.modelProviders,
  });
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
