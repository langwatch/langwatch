/**
 * Technical engine stream composition shared by the Workflow application.
 */
import { HandledError } from "@langwatch/handled-error";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import { createLogger } from "@langwatch/observability";
import {
  AwsNlpLambdaArnResolverAdapter,
  AwsNlpLambdaStreamInvokeAdapter,
  HttpWorkflowStudioStreamAdapter,
  InMemoryNlpLambdaArnCacheAdapter,
  LambdaWorkflowStudioStreamAdapter,
  NlpLambdaArnCachePort,
  NlpLambdaFunctionPort,
  NlpLambdaRuntimeService,
  NlpPayloadStagingPort,
  UnconfiguredWorkflowStudioStreamAdapter,
  WorkflowStudioDispatchService,
  WorkflowStudioStreamPort,
  type StudioLambdaConfig,
} from "@langwatch/workflow-server";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { LambdaClient } from "@aws-sdk/client-lambda";

/**
 * The ONE place this process builds a studio dispatch.
 */
export function composeApiWorkflowStudioDispatch(options: {
  nlpServiceUrl: string | undefined;
  modelProviders: ModelProviderService;
  payloadStaging?: NlpPayloadStagingPort | undefined;
  arnCache?: NlpLambdaArnCachePort | undefined;
  nlpLambdaFleet?: StudioLambdaConfig | undefined;
  nlpLambdaFleetNamed?: boolean;
}): WorkflowStudioDispatchService {
  return WorkflowStudioDispatchService.create({
    stream: composeApiWorkflowStudioStream(options),
    modelProviders: options.modelProviders,
  });
}

/** A configured fleet uses each project's function; invalid fleet config never falls back. */
export function composeApiWorkflowStudioStream(options: {
  nlpServiceUrl: string | undefined;
  payloadStaging?: NlpPayloadStagingPort | undefined;
  arnCache?: NlpLambdaArnCachePort | undefined;
  nlpLambdaFleet?: StudioLambdaConfig | undefined;
  nlpLambdaFleetNamed?: boolean;
}): WorkflowStudioStreamPort {
  const { nlpLambdaFleet: fleet } = options;
  if (fleet) {
    return composeLambdaStudioStream({ fleet, ...options });
  }

  if (options.nlpLambdaFleetNamed) {
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

/** Prevent a malformed fleet configuration from silently switching execution hosts. */
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
