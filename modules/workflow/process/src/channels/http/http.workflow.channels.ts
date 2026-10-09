import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { createLogger } from "@langwatch/observability";
import { nlpInternalSecret, type ScopedSecrets } from "@langwatch/secrets";
import { nlpLambdaFleetFromSecret, type WorkflowServerConfig } from "@langwatch/workflow-contract";

import {
  buildStudioLambdaConfig,
  studioLambdaConfigFingerprint,
} from "../../rules/nlp-lambda-config.rules.ts";
import { AwsNlpLambdaArnResolverChannel } from "../aws.nlp-lambda-arn-resolver.channel.ts";
import { AwsNlpLambdaFleetChannel } from "../aws.nlp-lambda-fleet.channel.ts";
import { AwsNlpLambdaInvokeChannel } from "../aws.nlp-lambda-invoke.channel.ts";
import { AwsNlpLambdaStreamInvokeChannel } from "../aws.nlp-lambda-stream-invoke.channel.ts";
import {
  nlpLambdaFleetSecret,
  s3KeySaltSecret,
  type WorkflowChannels,
} from "../workflow.channels.ts";
import {
  HttpWorkflowNlpRuntimeAdapter,
  UnconfiguredWorkflowNlpRuntimeAdapter,
} from "./http.workflow-nlp-runtime.channel.ts";
import {
  HttpWorkflowStudioStreamAdapter,
  UnconfiguredWorkflowStudioStreamAdapter,
} from "./http.workflow-studio-stream.channel.ts";

const logger = createLogger("langwatch:workflows");

/** Main's retry budget, enough to ride out a cold fleet's concurrency burst. */
const NLP_LAMBDA_CLIENT_MAX_ATTEMPTS = 6;

/**
 * Main's precedence: a named fleet wins, and one that cannot be used refuses by
 * name rather than falling back; with none, the engine address; with neither,
 * every run refuses by name. See modules/workflow/specs/studio-lambda-stream.feature.
 */
export class HttpWorkflowChannels {
  static readonly requires = [] as const;

  static async create({
    config,
    secrets,
  }: {
    config: WorkflowServerConfig;
    secrets: ScopedSecrets;
  }): Promise<WorkflowChannels> {
    const named = await secrets.into(nlpLambdaFleetSecret, (raw) =>
      nlpLambdaFleetFromSecret.safeParse(raw),
    );
    if (!named.success) {
      const reason =
        named.error.issues[0]?.message ?? "The NLP Lambda fleet configuration cannot be used.";
      logger.error({ reason }, "the named NLP Lambda fleet is unusable; studio runs will refuse");

      return {
        engine: {
          kind: "single",
          stream: UnconfiguredWorkflowStudioStreamAdapter.create({ reason }),
          runtime: UnconfiguredWorkflowNlpRuntimeAdapter.create({ reason }),
          perProjectEngines: true,
        },
      };
    }

    // The engine hop's shared credential (ADR-132); the process holds the same handle.
    const internalSecret = await secrets.into(nlpInternalSecret, (secret) => secret);
    const cacheKeySalt = await secrets.into(s3KeySaltSecret, (salt) => salt);
    if (named.data) {
      const fields = named.data;
      const lambdaConfig = buildStudioLambdaConfig({
        fields: {
          region: fields.AWS_REGION,
          accessKeyId: fields.AWS_ACCESS_KEY_ID,
          secretAccessKey: fields.AWS_SECRET_ACCESS_KEY,
          roleArn: fields.role_arn,
          imageUri: fields.image_uri,
          cacheBucket: fields.cache_bucket,
          subnetIds: fields.subnet_ids,
          securityGroupIds: fields.security_group_ids,
        },
        langwatchEndpoint: config.publicBaseUrl ?? "",
        codeBlockTimeoutRawValue: config.nlpCodeBlockTimeoutSeconds,
        stagingThresholdBytesRawValue: config.stagingThresholdBytes,
        stagingTtlSecondsRawValue: config.stagingTtlSeconds,
      });
      const credentials = {
        accessKeyId: lambdaConfig.accessKeyId,
        secretAccessKey: lambdaConfig.secretAccessKey,
      };
      const lambda = new LambdaClient({
        region: lambdaConfig.region,
        credentials,
        maxAttempts: NLP_LAMBDA_CLIENT_MAX_ATTEMPTS,
      });
      // One SDK attempt: its retry re-invokes a function that may already run customer code.
      const invokeLambda = new LambdaClient({
        region: lambdaConfig.region,
        credentials,
        maxAttempts: 1,
      });
      const logs = new CloudWatchLogsClient({ region: lambdaConfig.region, credentials });

      return {
        engine: {
          kind: "lambda",
          resolver: AwsNlpLambdaArnResolverChannel.create({
            lambda,
            logs,
            config: lambdaConfig,
            logger,
          }),
          streamInvoke: AwsNlpLambdaStreamInvokeChannel.create({ lambda }),
          invoke: AwsNlpLambdaInvokeChannel.create({ lambda: invokeLambda }),
          fleet: AwsNlpLambdaFleetChannel.create({ lambda, logs, logger }),
          imageUri: lambdaConfig.imageUri,
          configFingerprint: studioLambdaConfigFingerprint(lambdaConfig),
          stagingThresholdBytes: lambdaConfig.stagingThresholdBytes,
          stagingTtlSeconds: lambdaConfig.stagingTtlSeconds,
          internalSecret,
          cacheKeySalt,
          close: () => {
            lambda.destroy();
            invokeLambda.destroy();
            logs.destroy();
          },
        },
      };
    }

    const serviceUrl = config.nlpServiceUrl;
    if (!serviceUrl) {
      return {
        engine: {
          kind: "single",
          stream: UnconfiguredWorkflowStudioStreamAdapter.create(),
          runtime: UnconfiguredWorkflowNlpRuntimeAdapter.create(),
          perProjectEngines: false,
        },
      };
    }

    return {
      engine: {
        kind: "single",
        stream: HttpWorkflowStudioStreamAdapter.create({
          serviceUrl,
          internalSecret,
          cacheKeySalt,
        }),
        runtime: HttpWorkflowNlpRuntimeAdapter.create({ serviceUrl, internalSecret }),
        perProjectEngines: false,
      },
    };
  }
}
