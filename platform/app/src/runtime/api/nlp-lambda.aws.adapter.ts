import {
  CreateLogGroupCommand,
  PutRetentionPolicyCommand,
  type CloudWatchLogsClient,
} from "@aws-sdk/client-cloudwatch-logs";
import type { FunctionConfiguration, LambdaClient } from "@aws-sdk/client-lambda";
import {
  CreateFunctionCommand,
  GetFunctionCommand,
  UpdateFunctionCodeCommand,
} from "@aws-sdk/client-lambda";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";
import type { NlpLambdaDeploymentConfig } from "./nlp-lambda.config";
import type { NlpLambdaAwsClientPort } from "./nlp-lambda.ports";

const logger = createLogger("langwatch:langwatch-nlp-lambda");

export const LAMBDA_ARN_CACHE_TTL_MS = 10 * 60 * 1000;
export const LAMBDA_CLIENT_MAX_ATTEMPTS = 6;

const lambdaArnCacheEntrySchema = z.object({
  arn: z.string().min(1),
  imageUri: z.string().min(1),
});

type LambdaArnCacheEntry = z.infer<typeof lambdaArnCacheEntrySchema>;
type MemoryEntry = LambdaArnCacheEntry & { expiresAt: number };

export type NlpLambdaArnCache = {
  get(key: string): Promise<string | null>;
  setex(key: string, seconds: number, value: string): Promise<unknown>;
  del(key: string): Promise<unknown>;
};

function hasErrorName(error: unknown, expectedName: string): boolean {
  return error instanceof Error && error.name === expectedName;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Infrastructure adapter for the shared per-project NLP Lambda fleet. */
export class NlpLambdaAwsAdapter {
  private readonly memory = new Map<string, MemoryEntry>();
  private readonly inFlight = new Map<string, Promise<string>>();
  private deployment: NlpLambdaDeploymentConfig;
  private baseHost: string | undefined;
  private readonly cacheTtlSeconds = Math.ceil(LAMBDA_ARN_CACHE_TTL_MS / 1_000);

  private constructor(
    deployment: NlpLambdaDeploymentConfig,
    baseHost: string | undefined,
    private readonly redis: NlpLambdaArnCache | null,
    private readonly clients: NlpLambdaAwsClientPort,
  ) {
    this.deployment = deployment;
    this.baseHost = baseHost;
  }

  static create(input: {
    deployment: NlpLambdaDeploymentConfig;
    baseHost: string | undefined;
    redis: NlpLambdaArnCache | null;
    clients: NlpLambdaAwsClientPort;
  }): NlpLambdaAwsAdapter {
    return new NlpLambdaAwsAdapter(input.deployment, input.baseHost, input.redis, input.clients);
  }

  createLambdaClient(): LambdaClient {
    return this.clients.createLambdaClient();
  }

  createLogsClient(): CloudWatchLogsClient {
    return this.clients.createLogsClient();
  }

  close(): Promise<void> {
    return this.clients.close();
  }

  async getProjectLambdaArn(projectId: string): Promise<string> {
    const cached = await this.readCache(projectId);
    if (cached?.imageUri === this.deployment.image_uri) {
      return cached.arn;
    }
    if (cached !== undefined) {
      await this.deleteCache(projectId);
    }

    const current = this.inFlight.get(projectId);
    if (current !== undefined) {
      return current;
    }

    const resolution = this.resolveProjectLambdaArn(projectId).finally(() => {
      this.inFlight.delete(projectId);
    });
    this.inFlight.set(projectId, resolution);

    return resolution;
  }

  private async resolveProjectLambdaArn(projectId: string): Promise<string> {
    const functionName = `langwatch_nlp-${projectId}`;
    const lambda = this.createLambdaClient();
    let configuration: FunctionConfiguration | null;

    try {
      configuration = await this.tryReadFunctionConfiguration(lambda, functionName);
    } catch (error) {
      logger.error({ projectId, error }, "failed to check whether NLP Lambda exists");
      configuration = null;
    }

    if (configuration === null) {
      configuration = await this.createOrReadProjectLambda(lambda, functionName, projectId);
    } else {
      configuration = await this.updateImageWhenNeeded(
        lambda,
        functionName,
        projectId,
        configuration,
      );
    }

    await this.pollUntilReady(lambda, functionName);

    const arn = configuration.FunctionArn;
    if (arn === undefined) {
      throw new Error(`Failed to get ARN for Lambda function ${functionName}`);
    }

    await this.writeCache(projectId, { arn, imageUri: this.deployment.image_uri });
    return arn;
  }

  private async createOrReadProjectLambda(
    lambda: LambdaClient,
    functionName: string,
    projectId: string,
  ): Promise<FunctionConfiguration> {
    logger.info({ projectId }, "creating NLP Lambda for project");

    try {
      return await this.createProjectLambda(lambda, functionName);
    } catch (error) {
      const message = errorMessage(error);
      const creationRaced =
        message.includes("already exist") || message.includes("An update is in progress");
      if (!creationRaced) {
        throw error;
      }

      logger.info({ projectId }, "NLP Lambda already exists, waiting for its configuration");
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      const configuration = await this.tryReadFunctionConfiguration(lambda, functionName);
      if (configuration === null) {
        throw new Error("Error retrieving Lambda function");
      }
      return configuration;
    }
  }

  private async updateImageWhenNeeded(
    lambda: LambdaClient,
    functionName: string,
    projectId: string,
    configuration: FunctionConfiguration,
  ): Promise<FunctionConfiguration> {
    const details = await lambda.send(new GetFunctionCommand({ FunctionName: functionName }));
    const currentImageUri = details.Code?.ImageUri;
    if (currentImageUri === undefined || currentImageUri === this.deployment.image_uri) {
      return configuration;
    }

    logger.info({ projectId }, "updating NLP Lambda image after a deployment change");
    try {
      return await lambda.send(
        new UpdateFunctionCodeCommand({
          FunctionName: functionName,
          ImageUri: this.deployment.image_uri,
        }),
      );
    } catch (error) {
      if (!errorMessage(error).includes("An update is in progress")) {
        throw error;
      }
      logger.info({ projectId }, "NLP Lambda image update is already in progress");
      return configuration;
    }
  }

  private async createProjectLambda(
    lambda: LambdaClient,
    functionName: string,
  ): Promise<FunctionConfiguration> {
    const response = await lambda.send(
      new CreateFunctionCommand({
        FunctionName: functionName,
        Role: this.deployment.role_arn,
        Code: { ImageUri: this.deployment.image_uri },
        PackageType: "Image",
        Timeout: 900,
        MemorySize: 2_048,
        Architectures: ["arm64"],
        VpcConfig: {
          SubnetIds: this.deployment.subnet_ids,
          SecurityGroupIds: this.deployment.security_group_ids,
        },
        Environment: {
          Variables: {
            LANGWATCH_ENDPOINT: this.baseHost ?? "",
            STUDIO_RUNTIME: "async",
            AWS_LWA_INVOKE_MODE: "RESPONSE_STREAM",
            CACHE_BUCKET: this.deployment.cache_bucket,
          },
        },
        Tags: { Project: "langwatch", Type: "optimization-studio" },
      }),
    );

    try {
      await this.createLogGroupWithRetention(functionName);
    } catch (error) {
      logger.warn({ functionName, error }, "NLP Lambda was created but log retention was not set");
    }

    return response;
  }

  private async createLogGroupWithRetention(functionName: string): Promise<void> {
    const logs = this.createLogsClient();
    const logGroupName = `/aws/lambda/${functionName}`;

    try {
      await logs.send(new CreateLogGroupCommand({ logGroupName }));
    } catch (error) {
      if (!hasErrorName(error, "ResourceAlreadyExistsException")) {
        throw error;
      }
    }

    await logs.send(new PutRetentionPolicyCommand({ logGroupName, retentionInDays: 365 }));
  }

  private async pollUntilReady(lambda: LambdaClient, functionName: string): Promise<void> {
    for (let attempt = 0; attempt < 60; attempt++) {
      const configuration = await this.tryReadFunctionConfiguration(lambda, functionName);
      if (configuration === null) {
        throw new Error(`Lambda function ${functionName} disappeared during polling`);
      }
      if (configuration.State === "Active" && configuration.LastUpdateStatus === "Successful") {
        return;
      }
      if (configuration.State === "Failed" || configuration.LastUpdateStatus === "Failed") {
        const reason = configuration.StateReason ?? configuration.LastUpdateStatusReason;
        throw new Error(`Lambda function ${functionName} failed to become ready: ${reason}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    throw new Error(`Lambda function ${functionName} did not become ready within timeout`);
  }

  private async tryReadFunctionConfiguration(
    lambda: LambdaClient,
    functionName: string,
  ): Promise<FunctionConfiguration | null> {
    try {
      const response = await lambda.send(new GetFunctionCommand({ FunctionName: functionName }));
      return response.Configuration ?? null;
    } catch (error) {
      if (hasErrorName(error, "ResourceNotFoundException")) {
        return null;
      }
      throw error;
    }
  }

  private async readCache(projectId: string): Promise<LambdaArnCacheEntry | undefined> {
    if (this.redis !== null) {
      try {
        const serialized = await this.redis.get(`lambda_arn:${projectId}`);
        if (serialized === null) {
          return undefined;
        }
        return lambdaArnCacheEntrySchema.parse(JSON.parse(serialized));
      } catch {
        return this.readMemory(projectId);
      }
    }

    return this.readMemory(projectId);
  }

  private async writeCache(projectId: string, entry: LambdaArnCacheEntry): Promise<void> {
    this.memory.set(projectId, {
      ...entry,
      expiresAt: Date.now() + LAMBDA_ARN_CACHE_TTL_MS,
    });

    if (this.redis === null) {
      return;
    }
    try {
      await this.redis.setex(
        `lambda_arn:${projectId}`,
        this.cacheTtlSeconds,
        JSON.stringify(entry),
      );
    } catch {
      // The in-memory cache remains available while Redis is unavailable.
    }
  }

  private async deleteCache(projectId: string): Promise<void> {
    this.memory.delete(projectId);
    if (this.redis === null) {
      return;
    }
    try {
      await this.redis.del(`lambda_arn:${projectId}`);
    } catch {
      // Cache invalidation is best effort during a Redis outage.
    }
  }

  private readMemory(projectId: string): LambdaArnCacheEntry | undefined {
    const entry = this.memory.get(projectId);
    if (entry === undefined) {
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.memory.delete(projectId);
      return undefined;
    }
    return entry;
  }
}
