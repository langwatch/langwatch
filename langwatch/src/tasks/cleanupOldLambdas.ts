import {
  LambdaClient,
  ListFunctionsCommand,
  DeleteFunctionCommand,
} from "@aws-sdk/client-lambda";
import {
  CloudWatchLogsClient,
  DescribeLogStreamsCommand,
  DeleteLogGroupCommand,
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

export default async function execute() {
  const { lambda, logs } = createAWSClients();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  logger.info("Starting cleanup of old Lambda functions...");
  logger.info(`Cutoff date: ${sevenDaysAgo.toISOString()}`);

  try {
    // List all Lambda functions starting with langwatch_nlp-
    const listCommand = new ListFunctionsCommand({});
    const response = await lambda.send(listCommand);

    if (!response.Functions) {
      logger.info("No Lambda functions found");
      return;
    }

    const nlpLambdas = response.Functions.filter(
      (func) => func.FunctionName?.startsWith("langwatch_nlp-")
    );

    logger.info(`Found ${nlpLambdas.length} langwatch_nlp- Lambda functions`);

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

      if (lastEventTime < sevenDaysAgo) {
        logger.info(
          `Function ${func.FunctionName} is older than 7 days, deleting...`
        );

        // Delete the Lambda function
        await deleteLambdaFunction(lambda, func.FunctionName);

        // Delete the log group
        await deleteLogGroup(logs, func.FunctionName);

        logger.info(`Successfully cleaned up ${func.FunctionName}`);
      } else {
        logger.info(`Function ${func.FunctionName} is recent, keeping it`);
      }
    }

    logger.info("Lambda cleanup completed");
  } catch (error) {
    logger.error("Error during Lambda cleanup:", error);
    throw error;
  }
}
