/**
 * The AWS half of the NLP Lambda sweep: Lambda for the functions, CloudWatch
 * Logs for when each last spoke. Every "not found" is answered as an absence
 * rather than raised — a fleet that changed under a sweep is the normal case.
 */
import {
  CloudWatchLogsClient,
  DeleteLogGroupCommand,
  DescribeLogGroupsCommand,
  DescribeLogStreamsCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import {
  DeleteFunctionCommand,
  GetFunctionCommand,
  LambdaClient,
  ListFunctionsCommand,
} from "@aws-sdk/client-lambda";
import type { Logger } from "@langwatch/observability";
import { NlpLambdaFleetPort, type NlpLambdaFunction } from "../ports/nlp-lambda-fleet.port";

const LOG_GROUP_ROOT = "/aws/lambda/";

export class AwsNlpLambdaFleetAdapter extends NlpLambdaFleetPort {
  static create(options: {
    lambda: LambdaClient;
    logs: CloudWatchLogsClient;
    logger?: Pick<Logger, "warn">;
  }): AwsNlpLambdaFleetAdapter {
    return new AwsNlpLambdaFleetAdapter(options.lambda, options.logs, options.logger);
  }

  private constructor(
    private readonly lambda: LambdaClient,
    private readonly logs: CloudWatchLogsClient,
    private readonly logger: Pick<Logger, "warn"> | undefined,
  ) {
    super();
  }

  async listFunctions({
    namePrefix,
  }: {
    namePrefix: string;
  }): Promise<readonly NlpLambdaFunction[]> {
    const found: NlpLambdaFunction[] = [];
    let marker: string | undefined;
    do {
      const page = await this.lambda.send(
        new ListFunctionsCommand(marker ? { Marker: marker } : {}),
      );
      for (const fn of page.Functions ?? []) {
        if (fn.FunctionName?.startsWith(namePrefix)) found.push({ name: fn.FunctionName });
      }
      marker = page.NextMarker;
    } while (marker);
    return found;
  }

  async tryReadLastActivityAt({ functionName }: { functionName: string }): Promise<Date | null> {
    const logGroupName = `${LOG_GROUP_ROOT}${functionName}`;
    try {
      const response = await this.logs.send(
        new DescribeLogStreamsCommand({ logGroupName, orderBy: "LastEventTime", limit: 1 }),
      );
      const timestamp = response.logStreams?.[0]?.lastEventTimestamp;
      return timestamp ? new Date(timestamp) : null;
    } catch (error) {
      if (!isNotFound(error)) throw error;
      this.logger?.warn({ logGroupName }, "no log group for an NLP Lambda");
      return null;
    }
  }

  async functionExists({ functionName }: { functionName: string }): Promise<boolean> {
    try {
      await this.lambda.send(new GetFunctionCommand({ FunctionName: functionName }));
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  async deleteFunction({ functionName }: { functionName: string }): Promise<void> {
    try {
      await this.lambda.send(new DeleteFunctionCommand({ FunctionName: functionName }));
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }

  async listLogGroups({ namePrefix }: { namePrefix: string }): Promise<readonly string[]> {
    const response = await this.logs.send(
      new DescribeLogGroupsCommand({ logGroupNamePrefix: `${LOG_GROUP_ROOT}${namePrefix}` }),
    );
    return (response.logGroups ?? [])
      .map((group) => group.logGroupName)
      .filter((name): name is string => name !== undefined)
      .map((name) => name.slice(LOG_GROUP_ROOT.length));
  }

  async deleteLogGroup({ functionName }: { functionName: string }): Promise<void> {
    try {
      await this.logs.send(
        new DeleteLogGroupCommand({ logGroupName: `${LOG_GROUP_ROOT}${functionName}` }),
      );
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }
}

function isNotFound(error: unknown): boolean {
  return (error as { name?: string })?.name === "ResourceNotFoundException";
}
