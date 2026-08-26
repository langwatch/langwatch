import {
  NlpLambdaPayloadTooLargeError,
  type NlpLambdaFetchInit,
  type NlpLambdaFetchResponse,
  type NlpLambdaRuntime,
} from "~/runtime/api/nlp-lambda";

export { NlpLambdaPayloadTooLargeError as InvokePayloadTooLargeError };

export const lambdaFetch = async <T>(
  nlpLambda: NlpLambdaRuntime,
  urlOrArn: string,
  path: string,
  init?: NlpLambdaFetchInit,
): Promise<NlpLambdaFetchResponse<T>> => await nlpLambda.invoke<T>(urlOrArn, path, init);
