/**
 * The seam another package's characterization suite drives workflow through,
 * when faking the oversized-payload staging boundary would hide exactly the
 * failure the suite exists to catch (the real nlpgo Lambda-invoke path).
 */
export {
  NlpInvokeTransportAdapter,
  type NlpInvokeRequest,
  type NlpInvokeResponse,
  type NlpInvokeStagingConfig,
} from "./channels/workflow-nlp-lambda.channel.ts";
export {
  type NlpLambdaInvoke,
  type NlpPayloadStaging,
  type NlpLambdaInvokeResult,
  type StagedNlpPayload,
} from "./app/workflow.app.ts";
