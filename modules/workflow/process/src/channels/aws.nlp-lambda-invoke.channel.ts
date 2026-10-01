/**
 * The AWS half of a synchronous engine invoke: one `Invoke`, answered whole.
 * The envelope and the staged header are the caller's business.
 */
import { InvokeCommand, type LambdaClient } from "@aws-sdk/client-lambda";

import { type NlpLambdaInvoke, type NlpLambdaInvokeResult } from "./nlp-lambda.channel.ts";

export class AwsNlpLambdaInvokeChannel implements NlpLambdaInvoke {
  static create(options: { lambda: LambdaClient }): AwsNlpLambdaInvokeChannel {
    return new AwsNlpLambdaInvokeChannel(options.lambda);
  }

  private constructor(private readonly lambda: LambdaClient) {}

  async invoke(input: { functionArn: string; payload: string }): Promise<NlpLambdaInvokeResult> {
    const response = await this.lambda.send(
      new InvokeCommand({
        FunctionName: input.functionArn,
        InvocationType: "RequestResponse",
        Payload: input.payload,
      }),
    );

    return {
      statusCode: response.StatusCode ?? 200,
      functionError: response.FunctionError,
      payload: response.Payload ? Buffer.from(response.Payload).toString("utf-8") : "",
    };
  }
}
