/** One encrypted, signed push, ready for the browser's push service. */
export interface WebPushRequest {
  endpoint: string;
  headers: Readonly<Record<string, string>>;
  body: Uint8Array;
}

/** The push service's answer. */
export interface WebPushResponse {
  status: number;
  /** From the service's `Retry-After`, where it sent one. */
  retryAfterMs?: number;
}

/**
 * Posts one push to a push service. A network failure throws: a `DispatchError` that says
 * whether another attempt could go differently.
 */
export interface WebPushGateway {
  send(request: WebPushRequest): Promise<WebPushResponse>;
}
