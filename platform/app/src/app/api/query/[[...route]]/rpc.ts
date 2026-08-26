/**
 * The JSON-RPC protocol layer for the query domain.
 *
 * Everything here is about the ENVELOPE — codes, ids, the success and error
 * wrappers. Nothing here knows what LangWatchQL is; that lives in `app.v1.ts`.
 * The split is so the protocol can be reasoned about (and tested) without a
 * query service, and so a second method added later touches one table rather
 * than the shape of every reply.
 *
 * @see https://www.jsonrpc.org/specification
 * @see https://github.com/langwatch/langwatch/issues/7565#issuecomment-5424087900
 */

import { HandledError } from "@langwatch/handled-error";
import type { Context } from "hono";

/**
 * The reserved JSON-RPC codes.
 *
 * The -32xxx block is the protocol's own, and these five are the whole of it a
 * server may raise. Application failures do NOT get invented codes here —
 * they arrive as `SERVER_ERROR` with the canonical envelope in `data`, whose
 * `code` is the machine name a caller actually branches on. Minting a private
 * numeric space alongside a perfectly good string taxonomy is how a client ends
 * up with two switch statements for one failure.
 */
export const RPC_CODES = {
  /** The body was not JSON at all. */
  PARSE_ERROR: -32700,
  /** It was JSON, but not a JSON-RPC request. */
  INVALID_REQUEST: -32600,
  /** A well-formed request naming a method this door does not serve. */
  METHOD_NOT_FOUND: -32601,
  /** The method exists; its `params` did not typecheck. */
  INVALID_PARAMS: -32602,
  /** Anything else — including every application-level refusal. */
  SERVER_ERROR: -32603,
} as const;

export type RpcCode = (typeof RPC_CODES)[keyof typeof RPC_CODES];

/** A JSON-RPC id, as it may legally appear on the wire. */
export type RpcId = string | number | null | undefined;

/**
 * Where the handler stashes the id it parsed.
 *
 * The error handler runs on a request whose body has already been consumed, so
 * it cannot re-read the id from the payload — but a JSON-RPC client matches a
 * reply to a call BY that id, and an error that drops it is unroutable. The
 * handler records the id on the context as soon as it knows it, and the error
 * handler reads it back from here.
 */
export const RPC_ID_KEY = "rpcId";

/**
 * The context Variables this family adds, handed to `createProjectApp` as its
 * `Extra` so `c.set`/`c.get` stay typed instead of needing a cast at the one
 * place the id is recorded.
 */
export interface QueryRpcVariables {
  /** Keep in step with {@link RPC_ID_KEY}. */
  rpcId: RpcId;
}

/**
 * The id to echo on a reply, or `undefined` when we never got far enough to
 * learn one (a body that did not parse has no id to speak of).
 */
export function rpcIdOf(c: Context): RpcId {
  const id: unknown = c.get(RPC_ID_KEY);
  if (typeof id === "string" || typeof id === "number" || id === null) {
    return id;
  }
  return undefined;
}

/**
 * The JSON-RPC code for a thrown error.
 *
 * Only the two failures the protocol has a genuine code for are mapped;
 * everything else is `SERVER_ERROR` and carries its real identity in the
 * canonical `data`. `RpcMethodError` below is how a handler asks for one of
 * the specific codes explicitly.
 */
function codeFor(error: unknown): RpcCode {
  if (error instanceof RpcMethodError) return error.rpcCode;
  // The shared validator raises this when the envelope itself failed to
  // typecheck — which in JSON-RPC terms is precisely an invalid request.
  if (HandledError.isHandled(error) && error.code === "validation_error") {
    return RPC_CODES.INVALID_REQUEST;
  }
  if (HandledError.isHandled(error) && error.code === "malformed_request") {
    return RPC_CODES.PARSE_ERROR;
  }
  return RPC_CODES.SERVER_ERROR;
}

/**
 * An error that names its own JSON-RPC code.
 *
 * A `HandledError` so it flows through `canonicalErrorFor` like every other
 * refusal and gets the same body, status and `code` treatment — the RPC code
 * rides alongside rather than replacing any of that.
 */
export class RpcMethodError extends HandledError {
  readonly rpcCode: RpcCode;

  constructor(args: {
    rpcCode: RpcCode;
    code: string;
    message: string;
    httpStatus: number;
    meta?: Record<string, unknown>;
  }) {
    super(args.code, args.message, {
      httpStatus: args.httpStatus,
      fault: "customer",
      ...(args.meta ? { meta: args.meta } : {}),
    });
    this.name = "RpcMethodError";
    this.rpcCode = args.rpcCode;
  }
}

/**
 * A method the door does not serve.
 *
 * 404, because the thing named does not exist — the same answer a REST caller
 * gets for a path that is not there, for the same reason.
 *
 * In practice a caller does not reach this: the envelope schema enumerates the
 * methods, so an unknown one is refused as an invalid request (-32600, 400)
 * before dispatch runs. This exists for the case where the enum and the
 * dispatch table disagree — a method declared and never wired — which is a
 * bug in this family rather than a mistake by the caller, and 404 is a truer
 * answer to it than a 500. Both the code and the status are asserted, so the
 * day that stops being unreachable it is still described.
 */
export function methodNotFound(method: string): RpcMethodError {
  return new RpcMethodError({
    rpcCode: RPC_CODES.METHOD_NOT_FOUND,
    code: "method_not_found",
    message: `This endpoint does not serve a method named '${method}'.`,
    httpStatus: 404,
    meta: { method },
  });
}

/** The success envelope. */
export function rpcResultBody(args: { id: RpcId; result: unknown }): object {
  return {
    jsonrpc: "2.0",
    // An id that arrived as `null` is echoed as `null`; one that never arrived
    // is omitted rather than invented.
    ...(args.id === undefined ? {} : { id: args.id }),
    result: args.result,
  };
}

/**
 * The error envelope, wrapping a canonical body.
 *
 * `message` is taken from the canonical body so the sentence a caller reads is
 * the one the error actually wrote — including the 5xx redaction, which is why
 * the raw `error.message` is not used here.
 */
export function rpcErrorBody(args: {
  error: unknown;
  canonical: { error: { code: string; message: string } };
  c: Context;
}): object {
  const id = rpcIdOf(args.c);
  return {
    jsonrpc: "2.0",
    ...(id === undefined ? {} : { id }),
    error: {
      code: codeFor(args.error),
      message: args.canonical.error.message,
      data: args.canonical,
    },
  };
}
