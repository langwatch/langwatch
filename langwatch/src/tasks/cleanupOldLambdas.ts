import {
  LambdaClient,
  ListFunctionsCommand,
  DeleteFunctionCommand,
  GetFunctionCommand,
} from "@aws-sdk/client-lambda";
import {
  CloudWatchLogsClient,
  DescribeLogStreamsCommand,
  DeleteLogGroupCommand,
  DescribeLogGroupsCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import { createLogger } from "../utils/logger";

const logger = createLogger("langwatch:cleanup-old-lambdas");

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

const createAWSClients = () => {
  const config = parseLambdaConfig();
  const credentials = {
    accessKeyId: config.AWS_ACCESS_KEY_ID,
    secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
  };

  return {
    lambda: new LambdaClient({
      region: config.AWS_REGION,
      credentials,
    }),
    logs: new CloudWatchLogsClient({
      region: config.AWS_REGION,
      credentials,
    }),
    region: config.AWS_REGION,
  };
};

const getLastEventTime = async (
  logsClient: CloudWatchLogsClient,
  functionName: string
): Promise<Date | null> => {
  const logGroupName = `/aws/lambda/${functionName}`;

  try {
    const command = new DescribeLogStreamsCommand({
      logGroupName,
      orderBy: "LastEventTime",
      limit: 1,
    });

    const response = await logsClient.send(command);

    if (response.logStreams && response.logStreams[0]?.lastEventTimestamp) {
      return new Date(response.logStreams[0].lastEventTimestamp);
    }

    return null;
  } catch (error: any) {
    if (error.name === "ResourceNotFoundException") {
      logger.warn(`Log group not found: ${logGroupName}`);
      return null;
    }
    throw error;
  }
};

const deleteLambdaFunction = async (
  lambdaClient: LambdaClient,
  functionName: string
): Promise<void> => {
  try {
    const command = new DeleteFunctionCommand({
      FunctionName: functionName,
    });

    await lambdaClient.send(command);
    logger.info(`Deleted Lambda function: ${functionName}`);
  } catch (error: any) {
    if (error.name === "ResourceNotFoundException") {
      logger.warn(`Lambda function not found: ${functionName}`);
    } else {
      throw error;
    }
  }
};

const deleteLogGroup = async (
  logsClient: CloudWatchLogsClient,
  functionName: string
): Promise<void> => {
  const logGroupName = `/aws/lambda/${functionName}`;

  try {
    const command = new DeleteLogGroupCommand({
      logGroupName,
    });

    await logsClient.send(command);
    logger.info(`Deleted log group: ${logGroupName}`);
  } catch (error: any) {
    if (error.name === "ResourceNotFoundException") {
      logger.warn(`Log group not found: ${logGroupName}`);
    } else {
      throw error;
    }
  }
};

const checkLambdaExists = async (
  lambdaClient: LambdaClient,
  functionName: string
): Promise<boolean> => {
  try {
    await lambdaClient.send(
      new GetFunctionCommand({ FunctionName: functionName })
    );
    return true;
  } catch (error: any) {
    if (error.name === "ResourceNotFoundException") {
      return false;
    }
    throw error;
  }
};

const getAllLambdaFunctions = async (lambda: LambdaClient): Promise<any[]> => {
  const allFunctions: any[] = [];
  let marker: string | undefined;

  do {
    const listCommand = new ListFunctionsCommand({
      ...(marker ? { Marker: marker } : {}),
    });

    const response = await lambda.send(listCommand);

    if (response.Functions) {
      allFunctions.push(...response.Functions);
      logger.info(`Retrieved ${response.Functions.length} functions (total so far: ${allFunctions.length})`);
    }

    marker = response.NextMarker;
  } while (marker);

  return allFunctions;
};

export default async function execute() {
  const { lambda, logs } = createAWSClients();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);

  logger.info("Starting cleanup of old Lambda functions and log groups...");
  logger.info(`Lambda cutoff date (7 days): ${sevenDaysAgo.toISOString()}`);
  logger.info(`Log group cutoff date (365 days): ${oneYearAgo.toISOString()}`);

  try {
    // PHASE 1: Clean up Lambda functions (7 days) and their log groups (365 days)
    logger.info("=== PHASE 1: Processing existing Lambda functions ===");

    // Get all Lambda functions with pagination support
    const allFunctions = await getAllLambdaFunctions(lambda);
    logger.info(`Retrieved total of ${allFunctions.length} Lambda functions from account`);

    if (allFunctions.length === 0) {
      logger.info("No Lambda functions found");
    } else {
      const nlpLambdas = allFunctions.filter(
        (func) => func.FunctionName?.startsWith("langwatch_nlp-")
      );

      logger.info(`Found ${nlpLambdas.length} langwatch_nlp- Lambda functions out of ${allFunctions.length} total`);

      for (const func of nlpLambdas) {
        if (!func.FunctionName) continue;

        logger.info(`Checking function: ${func.FunctionName}`);

        // Get last event time from CloudWatch logs
        const lastEventTime = await getLastEventTime(logs, func.FunctionName);

        if (!lastEventTime) {
          logger.warn(
            `No last event time found for ${func.FunctionName}, skipping deletion`
          );
          continue;
        }

        logger.info(
          `Last event time for ${
            func.FunctionName
          }: ${lastEventTime.toISOString()}`
        );

        // Delete Lambda function if older than 7 days
        if (lastEventTime < sevenDaysAgo) {
          logger.info(
            `Function ${func.FunctionName} is older than 7 days, deleting Lambda...`
          );
          await deleteLambdaFunction(lambda, func.FunctionName);
        } else {
          logger.info(
            `Function ${func.FunctionName} is recent, keeping Lambda`
          );
        }

        // Delete log group if older than 365 days
        if (lastEventTime < oneYearAgo) {
          logger.info(
            `Log group for ${func.FunctionName} is older than 365 days, deleting logs...`
          );
          await deleteLogGroup(logs, func.FunctionName);
        } else {
          logger.info(
            `Log group for ${func.FunctionName} is recent enough, keeping logs`
          );
        }
      }
    }

    // PHASE 2: Clean up orphaned log groups (where Lambda function no longer exists)
    logger.info("=== PHASE 2: Processing orphaned log groups ===");

    const logGroupsCommand = new DescribeLogGroupsCommand({
      logGroupNamePrefix: "/aws/lambda/langwatch_nlp-",
    });
    const logGroupsResponse = await logs.send(logGroupsCommand);

    if (!logGroupsResponse.logGroups) {
      logger.info("No langwatch_nlp log groups found");
    } else {
      logger.info(
        `Found ${logGroupsResponse.logGroups.length} langwatch_nlp log groups`
      );

      for (const logGroup of logGroupsResponse.logGroups) {
        if (!logGroup.logGroupName) continue;

        // Extract function name from log group name: /aws/lambda/langwatch_nlp-xxx -> langwatch_nlp-xxx
        const functionName = logGroup.logGroupName.replace("/aws/lambda/", "");

        logger.info(`Checking orphaned log group: ${logGroup.logGroupName}`);

        // Check if the Lambda function still exists
        const lambdaExists = await checkLambdaExists(lambda, functionName);

        if (lambdaExists) {
          logger.info(
            `Lambda function ${functionName} still exists, skipping log group`
          );
          continue;
        }

        logger.info(
          `Lambda function ${functionName} no longer exists, checking log group age`
        );

        // Get last event time for this orphaned log group
        const lastEventTime = await getLastEventTime(logs, functionName);

        if (!lastEventTime) {
          logger.warn(
            `No last event time found for orphaned log group ${logGroup.logGroupName}, skipping deletion`
          );
          continue;
        }

        logger.info(
          `Last event time for orphaned log group ${
            logGroup.logGroupName
          }: ${lastEventTime.toISOString()}`
        );

        // Delete orphaned log group if older than 365 days
        if (lastEventTime < oneYearAgo) {
          logger.info(
            `Orphaned log group ${logGroup.logGroupName} is older than 365 days, deleting...`
          );
          await deleteLogGroup(logs, functionName);
        } else {
          logger.info(
            `Orphaned log group ${logGroup.logGroupName} is recent enough, keeping it`
          );
        }
      }
    }

    logger.info("Lambda and log group cleanup completed");
  } catch (error) {
    logger.error({ error }, "Error during Lambda cleanup, skipping");
  }
}
