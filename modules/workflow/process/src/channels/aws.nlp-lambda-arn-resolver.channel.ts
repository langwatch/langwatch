/**
 * Finds, creates, or reconciles the Lambda function one project's studio
 * engine runs on, and answers with its ARN. A pod never moves a function to an
 * older release than it runs: during a rollout old and new pods serve together.
 * @see specs/nlp-go/studio-lambda-cache.feature
 */
import type { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { CreateLogGroupCommand, PutRetentionPolicyCommand } from "@aws-sdk/client-cloudwatch-logs";
import {
  type LambdaClient,
  CreateFunctionCommand,
  GetFunctionCommand,
  TagResourceCommand,
  UpdateFunctionCodeCommand,
  UpdateFunctionConfigurationCommand,
  type FunctionConfiguration,
} from "@aws-sdk/client-lambda";
import type { Logger } from "@langwatch/observability";

import {
  LAMBDA_INVOCATION_TIMEOUT_SECONDS,
  NLP_LAMBDA_IMAGE_ORDER_TAG,
  NLP_LAMBDA_MEMORY_SIZE_MB,
  NLP_LAMBDA_NAME_PREFIX,
  buildStudioLambdaEnvironment,
  recordedImageOrder,
  studioLambdaRolloutStanding,
  type StudioLambdaConfig,
} from "../rules/nlp-lambda-config.rules.ts";
import { type NlpLambdaArnResolver, type NlpLambdaResolution } from "./nlp-lambda.channel.ts";

const LOG_GROUP_ROOT = "/aws/lambda/";
const LOG_RETENTION_DAYS = 365;
const READY_POLL_ATTEMPTS = 60;
const READY_POLL_INTERVAL_MS = 500;

export class AwsNlpLambdaArnResolverChannel implements NlpLambdaArnResolver {
  static create(options: {
    lambda: LambdaClient;
    logs: CloudWatchLogsClient;
    config: StudioLambdaConfig;
    logger?: Pick<Logger, "info" | "warn"> | undefined;
    /** Injected so a test drives the poll loop without real time. */
    wait?: (ms: number) => Promise<void>;
  }): AwsNlpLambdaArnResolverChannel {
    return new AwsNlpLambdaArnResolverChannel(options);
  }

  private constructor(
    private readonly options: {
      lambda: LambdaClient;
      logs: CloudWatchLogsClient;
      config: StudioLambdaConfig;
      logger?: Pick<Logger, "info" | "warn"> | undefined;
      wait?: (ms: number) => Promise<void>;
    },
  ) {}

  async resolve(input: { projectId: string }): Promise<NlpLambdaResolution> {
    const functionName = `${NLP_LAMBDA_NAME_PREFIX}${input.projectId}`;
    const existing = await this.tryReadConfiguration(functionName);
    const synced = existing
      ? await this.sync({ functionName, existing, projectId: input.projectId })
      : {
          current: await this.createFunction({ functionName, projectId: input.projectId }),
          ...this.ownImage(),
        };

    await this.pollUntilReady(functionName);

    const arn = synced.current.FunctionArn;
    if (!arn) {
      throw new Error(`AWS reported no ARN for the studio Lambda ${functionName}.`);
    }

    return { arn, imageUri: synced.imageUri, imageOrder: synced.imageOrder };
  }

  private ownImage(): { imageUri: string; imageOrder: number | undefined } {
    return { imageUri: this.options.config.imageUri, imageOrder: this.options.config.imageOrder };
  }

  private async tryReadConfiguration(functionName: string): Promise<FunctionConfiguration | null> {
    try {
      const response = await this.options.lambda.send(
        new GetFunctionCommand({ FunctionName: functionName }),
      );

      return response.Configuration ?? null;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  private async createFunction(input: {
    functionName: string;
    projectId: string;
  }): Promise<FunctionConfiguration> {
    const { config } = this.options;
    this.options.logger?.info(
      { projectId: input.projectId },
      "creating the project's studio Lambda",
    );

    let created: FunctionConfiguration;
    try {
      created = await this.options.lambda.send(
        new CreateFunctionCommand({
          FunctionName: input.functionName,
          Role: config.roleArn,
          Code: { ImageUri: config.imageUri },
          PackageType: "Image",
          Timeout: LAMBDA_INVOCATION_TIMEOUT_SECONDS,
          MemorySize: NLP_LAMBDA_MEMORY_SIZE_MB,
          Architectures: ["arm64"],
          VpcConfig: {
            SubnetIds: [...config.subnetIds],
            SecurityGroupIds: [...config.securityGroupIds],
          },
          Environment: { Variables: buildStudioLambdaEnvironment(config) },
          Tags: { Project: "langwatch", Type: "optimization-studio", ...this.imageOrderTag() },
        }),
      );
    } catch (error) {
      // Another pod won the race. The function it created is the answer.
      if (!isAlreadyExists(error) && !isUpdateInProgress(error)) throw error;
      const raced = await this.tryReadConfiguration(input.functionName);
      if (!raced) throw error;

      return raced;
    }

    await this.ensureLogGroup(input.functionName);

    return created;
  }

  /** Failing to file the log group must not fail the function that was created. */
  private async ensureLogGroup(functionName: string): Promise<void> {
    const logGroupName = `${LOG_GROUP_ROOT}${functionName}`;
    try {
      await this.options.logs.send(new CreateLogGroupCommand({ logGroupName }));
    } catch (error) {
      if (!isAlreadyExists(error)) {
        this.options.logger?.warn({ functionName, error }, "could not create the log group");

        return;
      }
    }

    try {
      await this.options.logs.send(
        new PutRetentionPolicyCommand({ logGroupName, retentionInDays: LOG_RETENTION_DAYS }),
      );
    } catch (error) {
      this.options.logger?.warn({ functionName, error }, "could not set the log retention");
    }
  }

  private imageOrderTag(): Record<string, string> {
    const order = this.options.config.imageOrder;

    return order === undefined ? {} : { [NLP_LAMBDA_IMAGE_ORDER_TAG]: String(order) };
  }

  /**
   * Brings an existing function's image, then its configuration, up to date,
   * unless a newer release already moved it (that pod owns both) or this pod
   * cannot read or write the order that would protect the move.
   */
  private async sync(input: {
    functionName: string;
    existing: FunctionConfiguration;
    projectId: string;
  }): Promise<{
    current: FunctionConfiguration;
    imageUri: string;
    imageOrder: number | undefined;
  }> {
    const { config } = this.options;
    const details = await this.options.lambda.send(
      new GetFunctionCommand({ FunctionName: input.functionName }),
    );
    let current = input.existing;
    const recorded = recordedImageOrder(details.Tags);
    const left = {
      current,
      imageUri: details.Code?.ImageUri ?? config.imageUri,
      imageOrder: recorded.kind === "recorded" ? recorded.order : void 0,
    };

    const standing = studioLambdaRolloutStanding({
      ours: config.imageOrder,
      tags: details.Tags,
      tagsUnreadable: details.TagsError !== undefined,
    });
    if (standing === "behind" || standing === "unknown") {
      this.options.logger?.info(
        { projectId: input.projectId, imageOrder: config.imageOrder, standing },
        "the studio Lambda's rollout order is newer or unreadable; leaving it as it is",
      );

      return left;
    }

    // Recorded before the image moves, so a pod still on the older release
    // that reads the function mid-update already sees it is behind.
    if (standing === "ahead") {
      const recorded = await this.recordImageOrder({
        functionArn: details.Configuration?.FunctionArn ?? input.existing.FunctionArn,
        projectId: input.projectId,
      });
      if (!recorded) return left;
    }

    const deployedImage = details.Code?.ImageUri;
    if (deployedImage && deployedImage !== config.imageUri) {
      const updated = await this.updateImage({
        functionName: input.functionName,
        projectId: input.projectId,
      });
      if (updated) current = updated;
    }

    // Read before either update and still a correct baseline: an image update
    // never changes the environment or the memory size.
    const reconciled = await this.reconcile({
      functionName: input.functionName,
      projectId: input.projectId,
      deployed: details.Configuration ?? input.existing,
    });

    return { current: reconciled ?? current, ...this.ownImage() };
  }

  /** An image moved without its order would be reverted by the older release, so none moves. */
  private async recordImageOrder(input: {
    functionArn: string | undefined;
    projectId: string;
  }): Promise<boolean> {
    if (!input.functionArn) return false;
    try {
      await this.options.lambda.send(
        new TagResourceCommand({ Resource: input.functionArn, Tags: this.imageOrderTag() }),
      );

      return true;
    } catch (error) {
      this.options.logger?.warn(
        { projectId: input.projectId, error },
        "could not record the image order on the studio Lambda; leaving it as it is",
      );

      return false;
    }
  }

  private async updateImage(input: {
    functionName: string;
    projectId: string;
  }): Promise<FunctionConfiguration | null> {
    const { functionName, projectId } = input;
    try {
      const updated = await this.options.lambda.send(
        new UpdateFunctionCodeCommand({
          FunctionName: functionName,
          ImageUri: this.options.config.imageUri,
        }),
      );
      // AWS refuses a configuration update while a code update is in flight,
      // so the image must land before the reconcile that follows it.
      await this.pollUntilReady(functionName);

      return updated;
    } catch (error) {
      if (isUpdateInProgress(error)) {
        this.options.logger?.info({ projectId }, "another update is in flight; leaving the image");

        return null;
      }
      throw error;
    }
  }

  private async reconcile(input: {
    functionName: string;
    projectId: string;
    deployed: FunctionConfiguration;
  }): Promise<FunctionConfiguration | null> {
    const desired = buildStudioLambdaEnvironment(this.options.config);
    const deployedEnv = input.deployed.Environment?.Variables ?? {};
    const drifted =
      Object.entries(desired).some(([key, value]) => deployedEnv[key] !== value) ||
      input.deployed.MemorySize !== NLP_LAMBDA_MEMORY_SIZE_MB ||
      input.deployed.Timeout !== LAMBDA_INVOCATION_TIMEOUT_SECONDS;
    if (!drifted) return null;

    try {
      return await this.options.lambda.send(
        new UpdateFunctionConfigurationCommand({
          FunctionName: input.functionName,
          // Merged rather than replaced: a variable set out of band is not
          // this code's to clobber.
          Environment: { Variables: { ...deployedEnv, ...desired } },
          MemorySize: NLP_LAMBDA_MEMORY_SIZE_MB,
          Timeout: LAMBDA_INVOCATION_TIMEOUT_SECONDS,
        }),
      );
    } catch (error) {
      if (isUpdateInProgress(error)) {
        this.options.logger?.info(
          { projectId: input.projectId },
          "another update is in flight; leaving the configuration",
        );

        return null;
      }
      throw error;
    }
  }

  private async pollUntilReady(functionName: string): Promise<void> {
    const wait = this.options.wait ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    for (let attempt = 0; attempt < READY_POLL_ATTEMPTS; attempt += 1) {
      const config = await this.tryReadConfiguration(functionName);
      if (!config) {
        throw new Error(`The studio Lambda ${functionName} disappeared while it was starting.`);
      }

      if (config.State === "Active" && config.LastUpdateStatus === "Successful") return;

      if (config.State === "Failed" || config.LastUpdateStatus === "Failed") {
        throw new Error(
          `The studio Lambda ${functionName} did not start: ${
            config.StateReason ?? config.LastUpdateStatusReason ?? "AWS gave no reason"
          }`,
        );
      }

      await wait(READY_POLL_INTERVAL_MS);
    }

    throw new Error(`The studio Lambda ${functionName} was still not ready after the poll window.`);
  }
}

function nameOf(error: unknown): string {
  return error instanceof Error ? error.name : "";
}

function isNotFound(error: unknown): boolean {
  return nameOf(error) === "ResourceNotFoundException";
}

function isAlreadyExists(error: unknown): boolean {
  return (
    nameOf(error) === "ResourceAlreadyExistsException" ||
    nameOf(error) === "ResourceConflictException" ||
    (error instanceof Error && error.message.includes("already exist"))
  );
}

function isUpdateInProgress(error: unknown): boolean {
  return (
    nameOf(error) === "ResourceConflictException" ||
    (error instanceof Error && error.message.includes("An update is in progress"))
  );
}
