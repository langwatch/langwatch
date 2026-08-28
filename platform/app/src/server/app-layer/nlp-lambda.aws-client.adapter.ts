import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { LambdaClient } from "@aws-sdk/client-lambda";
import {
  LAMBDA_CLIENT_MAX_ATTEMPTS,
  NlpLambdaAwsClientPort,
  type NlpLambdaDeploymentConfig,
} from "~/runtime/api/nlp-lambda";
import { type AppAwsClientConfiguration } from "~/runtime/app/aws-client.composition";

/** Process-owned Lambda and CloudWatch clients for one configured NLP fleet. */
export class AppNlpLambdaAwsClientAdapter extends NlpLambdaAwsClientPort {
  static create(input: {
    aws: AppAwsClientConfiguration;
    deployment: NlpLambdaDeploymentConfig;
  }): AppNlpLambdaAwsClientAdapter {
    return new AppNlpLambdaAwsClientAdapter(input.aws, input.deployment);
  }

  private lambda: LambdaClient | undefined;

  private logs: CloudWatchLogsClient | undefined;

  private closePromise: Promise<void> | undefined;

  private constructor(
    private readonly aws: AppAwsClientConfiguration,
    private readonly deployment: NlpLambdaDeploymentConfig,
  ) {
    super();
  }

  createLambdaClient(): LambdaClient {
    this.ensureOpen();
    this.lambda ??= new LambdaClient({
      ...this.clientConfig(this.serviceHost("lambda")),
      maxAttempts: LAMBDA_CLIENT_MAX_ATTEMPTS,
    });
    return this.lambda;
  }

  createLogsClient(): CloudWatchLogsClient {
    this.ensureOpen();
    this.logs ??= new CloudWatchLogsClient(this.clientConfig(this.serviceHost("logs")));
    return this.logs;
  }

  close(): Promise<void> {
    if (this.closePromise !== undefined) {
      return this.closePromise;
    }

    this.closePromise = Promise.resolve().then(() => {
      this.lambda?.destroy();
      this.logs?.destroy();
      this.lambda = undefined;
      this.logs = undefined;
    });
    return this.closePromise;
  }

  private clientConfig(targetHost: string) {
    return this.aws.build({
      region: this.deployment.AWS_REGION,
      targetHost,
      staticCredentials: {
        accessKeyId: this.deployment.AWS_ACCESS_KEY_ID,
        secretAccessKey: this.deployment.AWS_SECRET_ACCESS_KEY,
      },
    });
  }

  private serviceHost(service: "lambda" | "logs"): string {
    const suffix = this.deployment.AWS_REGION.startsWith("cn-")
      ? "amazonaws.com.cn"
      : "amazonaws.com";
    return `${service}.${this.deployment.AWS_REGION}.${suffix}`;
  }

  private ensureOpen(): void {
    if (this.closePromise !== undefined) {
      throw new Error("NLP Lambda AWS clients are closed.");
    }
  }
}
