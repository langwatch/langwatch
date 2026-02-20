import {
  CloudWatchLogsClient,
  CreateLogGroupCommand,
  PutRetentionPolicyCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import type { FunctionConfiguration } from "@aws-sdk/client-lambda";
import {
  CreateFunctionCommand,
  GetFunctionCommand,
  InvokeWithResponseStreamCommand,
  LambdaClient,
  UpdateFunctionCodeCommand,
} from "@aws-sdk/client-lambda";
import { env } from "../../env.mjs";
import { createLogger } from "../../utils/logger/server";
import { captureException } from "../../utils/posthogErrorCapture";
import type { StudioClientEvent } from "../types/events";

const logger = createLogger("langwatch:langwatch-nlp-lambda");

/**
 * Strip secrets from a studio event before passing to error reporters.
 * Returns a shallow copy with workflow.secrets redacted.
 */
const sanitizeEventForLogging = (
  event: StudioClientEvent,
): StudioClientEvent => {
  if (!("payload" in event) || !("workflow" in (event as any).payload)) {
    return event;
  }
  const payload = (event as any).payload;
  return {
    ...event,
    payload: {
      ...payload,
      workflow: {
        ...payload.workflow,
        secrets: "[REDACTED]",
      },
    },
  } as StudioClientEvent;
};

type LangWatchLambdaConfig = {
  AWS_ACCESS_KEY_ID: string;
  AWS_SECRET_ACCESS_KEY: string;
  AWS_REGION: string;
  role_arn: string;
  image_uri: string;
  cache_bucket: string;
  subnet_ids: string[];
  security_group_ids: string[];
};

const parseLambdaConfig = (): LangWatchLambdaConfig => {
  const configStr = process.env.LANGWATCH_NLP_LAMBDA_CONFIG;
  if (!configStr) {
    throw new Error(
      "LANGWATCH_NLP_LAMBDA_CONFIG environment variable is required",
    );
  }

  try {
    return JSON.parse(configStr) as LangWatchLambdaConfig;
  } catch (error) {
    throw new Error(
      "Failed to parse LANGWATCH_NLP_LAMBDA_CONFIG: " + String(error),
    );
  }
};

export const createLambdaClient = (): LambdaClient => {
  const config = parseLambdaConfig();
  return new LambdaClient({
    region: config.AWS_REGION,
    credentials: {
      accessKeyId: config.AWS_ACCESS_KEY_ID,
      secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
    },
  });
};

const createLogsClient = (): CloudWatchLogsClient => {
  const config = parseLambdaConfig();
  return new CloudWatchLogsClient({
    region: config.AWS_REGION,
    credentials: {
      accessKeyId: config.AWS_ACCESS_KEY_ID,
      secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
    },
  });
};

const checkLambdaExists = async (
  lambda: LambdaClient,
  functionName: string,
): Promise<FunctionConfiguration | null> => {
  try {
    const command = new GetFunctionCommand({ FunctionName: functionName });
    const response = await lambda.send(command);
    return response.Configuration ?? null;
  } catch (error: any) {
    if (error.name === "ResourceNotFoundException") {
      return null;
    }
    throw error;
  }
};

const createLogGroupWithRetention = async (
  functionName: string,
  retentionInDays = 365,
): Promise<void> => {
  const logsClient = createLogsClient();
  const logGroupName = `/aws/lambda/${functionName}`;

  try {
    // Create the log group
    const createCommand = new CreateLogGroupCommand({
      logGroupName,
    });
    await logsClient.send(createCommand);

    logger.info({ functionName }, "Created log group for Lambda function");

    // Set retention policy
    const retentionCommand = new PutRetentionPolicyCommand({
      logGroupName,
      retentionInDays,
    });
    await logsClient.send(retentionCommand);

    logger.info(
      { functionName, retentionInDays },
      `Set log group retention policy to ${retentionInDays} days`,
    );
  } catch (error: any) {
    if (error.name === "ResourceAlreadyExistsException") {
      // Log group already exists, just set retention
      logger.info(
        { functionName },
        "Log group already exists, setting retention policy",
      );

      const retentionCommand = new PutRetentionPolicyCommand({
        logGroupName,
        retentionInDays,
      });
      await logsClient.send(retentionCommand);

      logger.info(
        { functionName, retentionInDays },
        `Updated existing log group retention policy to ${retentionInDays} days`,
      );
    } else {
      logger.error(
        { functionName, error },
        "Failed to create log group or set retention policy",
      );
      throw error;
    }
  }
};

const createProjectLambda = async (
  lambda: LambdaClient,
  functionName: string,
  config: LangWatchLambdaConfig,
): Promise<FunctionConfiguration> => {
  const command = new CreateFunctionCommand({
    FunctionName: functionName,
    Role: config.role_arn,
    Code: {
      ImageUri: config.image_uri,
    },
    PackageType: "Image",
    Timeout: 900, // 15 minutes
    MemorySize: 1024,
    Architectures: ["arm64"],
    VpcConfig: {
      SubnetIds: config.subnet_ids,
      SecurityGroupIds: config.security_group_ids,
    },
    Environment: {
      Variables: {
        LANGWATCH_ENDPOINT: env.BASE_HOST,
        STUDIO_RUNTIME: "async",
        AWS_LWA_INVOKE_MODE: "RESPONSE_STREAM",
        CACHE_BUCKET: config.cache_bucket,
      },
    },
    Tags: {
      Project: "langwatch",
      Type: "optimization-studio",
    },
  });

  const response = await lambda.send(command);

  // Create log group with retention policy immediately after Lambda creation
  try {
    await createLogGroupWithRetention(functionName, 365);
  } catch (error) {
    // Log the error but don't fail Lambda creation
    logger.warn(
      { functionName, error },
      "Failed to create log group with retention, Lambda function created successfully",
    );
  }

  return response;
};

const pollLambdaUntilReady = async (
  lambda: LambdaClient,
  functionName: string,
  maxAttempts = 60, // 5 minutes with 5-second intervals
  intervalMs = 500,
): Promise<void> => {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const config = await checkLambdaExists(lambda, functionName);

    if (!config) {
      throw new Error(
        `Lambda function ${functionName} disappeared during polling`,
      );
    }

    if (config.State === "Active" && config.LastUpdateStatus === "Successful") {
      return;
    }

    if (config.State === "Failed" || config.LastUpdateStatus === "Failed") {
      throw new Error(
        `Lambda function ${functionName} failed to become ready: ${
          config.StateReason ?? config.LastUpdateStatusReason
        }`,
      );
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(
    `Lambda function ${functionName} did not become ready within timeout`,
  );
};

const updateProjectLambdaImage = async (
  lambda: LambdaClient,
  functionName: string,
  newImageUri: string,
  projectId: string,
): Promise<FunctionConfiguration> => {
  logger.info(
    { projectId },
    `Updating Lambda function ${functionName} with new image: ${newImageUri}`,
  );

  const command = new UpdateFunctionCodeCommand({
    FunctionName: functionName,
    ImageUri: newImageUri,
  });

  const response = await lambda.send(command);
  return response;
};

export const getProjectLambdaArn = async (
  projectId: string,
): Promise<string> => {
  const config = parseLambdaConfig();
  const lambda = createLambdaClient();
  const functionName = `langwatch_nlp-${projectId}`;

  // Check if Lambda exists
  let lambdaConfig = await checkLambdaExists(lambda, functionName);

  if (!lambdaConfig) {
    // Create the Lambda function (includes log group creation with retention)
    logger.info({ projectId }, `Creating Lambda function for project`);
    try {
      lambdaConfig = await createProjectLambda(lambda, functionName, config);
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes("already exist") ||
          error.message.includes("An update is in progress"))
      ) {
        logger.info(
          { projectId },
          "Lambda function already exists, skipping creation",
        );
        await new Promise((resolve) => setTimeout(resolve, 1000));
        lambdaConfig = await checkLambdaExists(lambda, functionName);
        if (!lambdaConfig) {
          throw new Error("Error retrieving Lambda function");
        }
      } else {
        throw error;
      }
    }
  } else {
    // Get complete function details to check image URI
    const getFunctionCommand = new GetFunctionCommand({
      FunctionName: functionName,
    });
    const functionDetails = await lambda.send(getFunctionCommand);

    const currentImageUri = functionDetails.Code?.ImageUri;
    if (currentImageUri && currentImageUri !== config.image_uri) {
      logger.info(
        { projectId },
        `Image URI mismatch for ${functionName}. Current: ${currentImageUri}, Expected: ${config.image_uri}. Updating lambda image`,
      );

      try {
        lambdaConfig = await updateProjectLambdaImage(
          lambda,
          functionName,
          config.image_uri,
          projectId,
        );
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes("An update is in progress")
        ) {
          logger.info(
            { projectId },
            "Lambda function update in progress, skipping update",
          );
        } else {
          throw error;
        }
      }
    }
  }

  // Poll until Lambda is ready
  await pollLambdaUntilReady(lambda, functionName);

  // Return the ARN
  if (!lambdaConfig.FunctionArn) {
    throw new Error(`Failed to get ARN for Lambda function ${functionName}`);
  }

  return lambdaConfig.FunctionArn;
};

export const invokeLambda = async (
  projectId: string,
  event: StudioClientEvent,
  s3CacheKey: string | undefined,
): Promise<ReadableStreamDefaultReader<Uint8Array>> => {
  const payload = {
    body: JSON.stringify(event),
    headers: {
      "Content-Type": "application/json",
      ...(s3CacheKey ? { "X-S3-Cache-Key": s3CacheKey } : {}),
    },
  };

  // Check if we should use the new dynamic Lambda approach
  if (process.env.LANGWATCH_NLP_LAMBDA_CONFIG) {
    const lambda = createLambdaClient();

    // Get the project-specific Lambda ARN
    const functionArn = await getProjectLambdaArn(projectId);

    const command = new InvokeWithResponseStreamCommand({
      FunctionName: functionArn,
      InvocationType: "RequestResponse",
      Payload: JSON.stringify({
        rawPath: "/studio/execute",
        requestContext: {
          http: {
            method: "POST",
          },
        },
        ...payload,
      }),
    });

    const { EventStream } = await lambda.send(command);

    if (!EventStream) {
      throw new Error("No payload received from Lambda");
    }

    const webStream = new ReadableStream({
      async start(controller) {
        try {
          let statusCode = 200;
          let errorMessage = "";

          for await (const chunk of EventStream) {
            if (chunk.PayloadChunk?.Payload) {
              const payloadText = new TextDecoder().decode(
                chunk.PayloadChunk.Payload,
              );
              if (statusCode < 200 || statusCode >= 300) {
                errorMessage += payloadText;
              }
              if (payloadText.includes('{"statusCode":')) {
                try {
                  statusCode = parseInt(JSON.parse(payloadText).statusCode);
                } catch {
                  /* this is just a safe json parse fallback */
                }
              }
              controller.enqueue(chunk.PayloadChunk.Payload);
            }
            if (chunk.InvokeComplete?.ErrorCode) {
              const error = new Error(
                `Failed run workflow: ${chunk.InvokeComplete.ErrorCode}`,
              );
              captureException(error, {
                extra: { event: sanitizeEventForLogging(event), details: chunk.InvokeComplete.ErrorDetails },
              });
              throw error;
            }
          }

          if (statusCode < 200 || statusCode >= 300) {
            try {
              errorMessage = JSON.parse(errorMessage.trim());
            } catch {
              /* this is just a safe json parse fallback */
            }

            if (statusCode === 422) {
              logger.error(
                { event: sanitizeEventForLogging(event), errorMessage },
                "Optimization Studio validation failed, please contact support",
              );
              const error = new Error(
                `Optimization Studio validation failed, please contact support`,
              );
              captureException(error, { extra: { event: sanitizeEventForLogging(event) } });
              throw error;
            }
            throw new Error(
              `Failed run workflow: ${statusCode}\n\n${errorMessage}`,
            );
          }
          controller.close();
        } catch (error) {
          logger.error({ error }, "failed to run workflow stream");
          controller.error(error);
        }
      },
    });

    return webStream.getReader();
  } else {
    const response = await fetch(
      `${process.env.LANGWATCH_NLP_SERVICE}/studio/execute`,
      {
        method: "POST",
        ...payload,
      },
    );

    if (!response.ok) {
      let body = await response.text();
      try {
        body = JSON.parse(body);
      } catch {
        /* this is just a safe json parse fallback */
      }

      if (response.status === 422) {
        console.error(
          "Optimization Studio validation failed, please contact support",
          "\n\n",
          JSON.stringify(sanitizeEventForLogging(event), null, 2),
          "\n\nValidation error:\n",
          body,
        );
        const error = new Error(
          `Optimization Studio validation failed, please contact support`,
        );
        captureException(error, { extra: { event: sanitizeEventForLogging(event) } });
        throw error;
      }
      throw new Error(`Failed run workflow: ${response.statusText}\n\n${body}`);
    }

    if (!response.body) {
      throw new Error("No response body");
    }

    return response.body.getReader();
  }
};
