import { InvokeCommand } from "@aws-sdk/client-lambda";
import { createLambdaClient } from "../optimization_studio/server/lambda";

type LambdaFetchInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

type LambdaFetchResponse<T> = {
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<T>;
  text: () => Promise<string>;
};

export const lambdaFetch = async <T>(
  urlOrArn: string,
  path: string,
  init?: LambdaFetchInit
): Promise<LambdaFetchResponse<T>> => {
  // If it's a Lambda ARN
  if (urlOrArn.startsWith("arn:aws:lambda")) {
    const lambda = createLambdaClient();

    const payload = {
      rawPath: path,
      requestContext: {
        http: {
          method: init?.method ?? "GET",
        },
      },
      headers: init?.headers ?? {},
      body: init?.body,
    };

    const command = new InvokeCommand({
      FunctionName: urlOrArn,
      InvocationType: "RequestResponse",
      Payload: JSON.stringify(payload),
    });

    const response = await lambda.send(command);
    const responsePayload = response.Payload
      ? Buffer.from(response.Payload).toString("utf-8")
      : "";

    const actualBody =
      responsePayload.split("\u0000").filter(Boolean).pop() ?? "";

    const statusCode = response.StatusCode ?? 200;

    return {
      ok: statusCode >= 200 && statusCode < 300,
      status: statusCode,
      statusText: response.FunctionError ?? "OK",
      json: async () => {
        return JSON.parse(actualBody);
      },
      text: async () => actualBody,
    };
  }

  // If it's a regular URL
  const response = await fetch(urlOrArn + path, init);
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    json: () => response.json() as Promise<T>,
    text: () => response.text(),
  };
};
