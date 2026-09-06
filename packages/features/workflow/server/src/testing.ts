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
} from "./adapters/workflow-nlp-lambda.adapter";
export {
  NlpLambdaInvokePort,
  NlpPayloadStagingPort,
  type NlpLambdaInvokeResult,
  type StagedNlpPayload,
} from "./ports/workflow-nlp-lambda.port";
