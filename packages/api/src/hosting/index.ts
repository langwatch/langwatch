// How this process answers a request: one muxer with middleware that is true of
// every request and one route per prefix, the API's whole surface behind
// `/api`, and the browser application behind `/`.

export { answerApiFailure, composeApiApplication } from "./api-application.ts";
export {
  HttpMux,
  type HttpExchange,
  type HttpFailureAnswer,
  type HttpHandler,
  type HttpMiddleware,
  type HttpReporter,
  type HttpTarget,
  type NodeHandler,
} from "./http-mux.ts";
export { BrowserBundle, type PublicConfigHead, type DocumentAccess } from "./browser-bundle.ts";

export { FramedDocument, type FramedDocumentSelection } from "./framed-document.ts";
export { TransportSelection, type SurfacePolicy } from "./transport-selection.ts";
