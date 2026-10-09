import { Secret } from "@langwatch/secrets";

import type { WorkflowNlpRuntime } from "../app/workflow.app.ts";
import type { AwsNlpLambdaFleetChannel } from "./aws.nlp-lambda-fleet.channel.ts";
import type {
  NlpLambdaArnResolver,
  NlpLambdaInvoke,
  NlpLambdaStreamInvoke,
  WorkflowStudioStream,
} from "./nlp-lambda.channel.ts";

/** The per-project studio fleet (`LANGWATCH_NLP_LAMBDA_CONFIG`): a credential, not config. */
export const nlpLambdaFleetSecret = Secret.load("LANGWATCH_NLP_LAMBDA_CONFIG", { optional: true });

/** Main's salt for the per-project engine cache key (`S3_KEY_SALT`); unset sends none. */
export const s3KeySaltSecret = Secret.load("S3_KEY_SALT", { optional: true });

/** An engine whose stream and runtime are already whole: one address, or none usable. */
type WorkflowSingleEngine = Readonly<{
  kind: "single";
  stream: WorkflowStudioStream;
  runtime: WorkflowNlpRuntime;
  /** A fleet is named, usable or not: main's `LANGWATCH_NLP_LAMBDA_CONFIG` presence test. */
  perProjectEngines: boolean;
}>;

/** The AWS channels of a project-function engine; the app resolves ARNs over them. */
type WorkflowLambdaEngine = Readonly<{
  kind: "lambda";
  resolver: NlpLambdaArnResolver;
  streamInvoke: NlpLambdaStreamInvoke;
  invoke: NlpLambdaInvoke;
  fleet: AwsNlpLambdaFleetChannel;
  imageUri: string;
  configFingerprint: string;
  stagingThresholdBytes: number;
  stagingTtlSeconds: number;
  internalSecret: string | undefined;
  cacheKeySalt: string | undefined;
  /** Releases the AWS clients the channels share. */
  close(): void;
}>;

/** Every channel workflow holds, as the container hands them to the module class. */
export interface WorkflowChannels {
  readonly engine: WorkflowSingleEngine | WorkflowLambdaEngine;
}
