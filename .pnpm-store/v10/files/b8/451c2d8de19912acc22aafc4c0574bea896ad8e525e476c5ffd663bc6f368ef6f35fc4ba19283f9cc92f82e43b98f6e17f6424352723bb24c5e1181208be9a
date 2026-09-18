import type { ClientHttp2Session } from "node:http2";
import type { ConnectionPool } from "@smithy/types";
import { ClientHttp2SessionRef } from "./http2/ClientHttp2SessionRef";
/**
 * These are keyed by URL, therefore all sessions within this class' state
 * are for the same URL.
 *
 * Sessions remain in the pool for their entire lifetime (until destroyed or
 * removed). The pool tracks capacity via each session's ref count.
 *
 * Interface implementation changed from ConnectionPool<ClientHttp2Session>.
 * @since 4.6.0
 * @internal
 */
export declare class NodeHttp2ConnectionPool implements ConnectionPool<ClientHttp2SessionRef> {
    private readonly sessions;
    private maxConcurrency;
    constructor(sessions?: ClientHttp2Session[]);
    /**
     * Find a session with available capacity (refs < maxConcurrency).
     * Returns undefined if all sessions are at capacity or the pool is empty.
     */
    poll(): ClientHttp2SessionRef | undefined;
    /**
     * Add a session to the pool.
     */
    offerLast(ref: ClientHttp2SessionRef): void;
    remove(ref: ClientHttp2SessionRef): void;
    [Symbol.iterator](): ArrayIterator<ClientHttp2SessionRef>;
    setMaxConcurrency(maxConcurrency: number): void;
    /**
     * This is unused, but part of the interface.
     * @deprecated
     */
    destroy(ref: ClientHttp2SessionRef): void;
}
