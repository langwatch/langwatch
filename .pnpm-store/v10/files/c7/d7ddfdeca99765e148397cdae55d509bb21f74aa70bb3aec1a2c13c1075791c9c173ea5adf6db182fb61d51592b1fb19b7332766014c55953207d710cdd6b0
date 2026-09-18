import type { ClientHttp2Stream } from "node:http2";
import type { ClientRequest } from "node:http";
import type { HttpRequest } from "@smithy/types";
/**
 * This resolves when writeBody has been called.
 *
 * @param httpRequest - opened Node.js request.
 * @param request - container with the request body.
 * @param maxContinueTimeoutMs - time to wait for the continue event.
 * @param externalAgent - whether agent is owned by caller code.
 */
export declare function writeRequestBody(httpRequest: ClientRequest | ClientHttp2Stream, request: HttpRequest, maxContinueTimeoutMs?: number, externalAgent?: boolean): Promise<void>;
