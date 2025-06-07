import {
  LambdaClient,
  InvokeWithResponseStreamCommand,
  CreateFunctionCommand,
  GetFunctionCommand,
  UpdateFunctionCodeCommand,
} from "@aws-sdk/client-lambda";
import type { FunctionConfiguration } from "@aws-sdk/client-lambda";
import type { StudioClientEvent } from "../types/events";
import * as Sentry from "@sentry/node";
import { env } from "../../env.mjs";
import { createLogger } from "../../utils/logger";

const logger = createLogger("langwatch:langwatch-nlp-lambda");

type LangWatchLambdaConfig = {
  AWS_ACCESS_KEY_ID: string;
  AWS_SECRET_ACCESS_KEY: string;
  AWS_REGION: string;
  role_arn: string;
  image_uri: string;
  cache_bucket: string;
};

const parseLambdaConfig = (): LangWatchLambdaConfig => {
  const configStr = process.env.LANGWATCH_NLP_LAMBDA_CONFIG;
  if (!configStr) {
    throw new Error(
      "LANGWATCH_NLP_LAMBDA_CONFIG environment variable is required"
    );
  }

  try {
    return JSON.parse(configStr) as LangWatchLambdaConfig;
  } catch (error) {
    throw new Error("Failed to parse LANGWATCH_NLP_LAMBDA_CONFIG: " + error);
  }
};

const createLambdaClient = (): LambdaClient => {
  const config = parseLambdaConfig();
  return new LambdaClient({
    region: config.AWS_REGION,
    credentials: {
      accessKeyId: config.AWS_ACCESS_KEY_ID,
      secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
    },
  });
};

const checkLambdaExists = async (
  lambda: LambdaClient,
  functionName: string
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

const createProjectLambda = async (
  lambda: LambdaClient,
  functionName: string,
  config: LangWatchLambdaConfig
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
  return response;
};

const pollLambdaUntilReady = async (
  lambda: LambdaClient,
  functionName: string,
  maxAttempts: number = 60, // 5 minutes with 5-second intervals
  intervalMs: number = 500
): Promise<void> => {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const config = await checkLambdaExists(lambda, functionName);

    if (!config) {
      throw new Error(
        `Lambda function ${functionName} disappeared during polling`
      );
    }

    if (config.State === "Active" && config.LastUpdateStatus === "Successful") {
      return;
    }

    if (config.State === "Failed" || config.LastUpdateStatus === "Failed") {
      throw new Error(
        `Lambda function ${functionName} failed to become ready: ${
          config.StateReason ?? config.LastUpdateStatusReason
        }`
      );
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(
    `Lambda function ${functionName} did not become ready within timeout`
  );
};

const updateProjectLambdaImage = async (
  lambda: LambdaClient,
  functionName: string,
  newImageUri: string,
  projectId: string
): Promise<FunctionConfiguration> => {
  logger.info(
    { projectId },
    `Updating Lambda function ${functionName} with new image: ${newImageUri}`
  );

  const command = new UpdateFunctionCodeCommand({
    FunctionName: functionName,
    ImageUri: newImageUri,
  });

  const response = await lambda.send(command);
  return response;
};

const getProjectLambdaArn = async (projectId: string): Promise<string> => {
  const config = parseLambdaConfig();
  const lambda = createLambdaClient();
  const functionName = `langwatch_nlp-${projectId}`;

  // Check if Lambda exists
  let lambdaConfig = await checkLambdaExists(lambda, functionName);

  if (!lambdaConfig) {
    // Create the Lambda function
    logger.info({ projectId }, `Creating Lambda function for project`);
    lambdaConfig = await createProjectLambda(lambda, functionName, config);
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
        `Image URI mismatch for ${functionName}. Current: ${currentImageUri}, Expected: ${config.image_uri}. Updating lambda image`
      );
      lambdaConfig = await updateProjectLambdaImage(
        lambda,
        functionName,
        config.image_uri,
        projectId
      );
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
  s3CacheKey: string | undefined
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
          for await (const chunk of EventStream) {
            if (chunk.PayloadChunk?.Payload) {
              controller.enqueue(chunk.PayloadChunk.Payload);
            }
            if (chunk.InvokeComplete?.ErrorCode) {
              const error = new Error(
                `Failed run workflow: ${chunk.InvokeComplete.ErrorCode}`
              );
              Sentry.captureException(error, {
                extra: { event, details: chunk.InvokeComplete.ErrorDetails },
              });
              throw error;
            }
          }
          controller.close();
        } catch (error) {
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
      }
    );

    if (!response.ok) {
      let body = await response.text();
      try {
        body = JSON.stringify(body, null, 2);
      } catch {}
      if (response.status === 422) {
        console.error(
          "Optimization Studio validation failed, some components might be outdated",
          "\n\n",
          JSON.stringify(event, null, 2)
        );
        const error = new Error(
          `Optimization Studio validation failed, some components might be outdated`
        );
        Sentry.captureException(error, { extra: { event } });
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
