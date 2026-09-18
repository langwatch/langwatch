import { type ClientSessionOptions, type SecureClientSessionOptions } from "node:http2";
import type { ConnectConfiguration, ConnectionManager, ConnectionManagerConfiguration, RequestContext } from "@smithy/types";
import { ClientHttp2SessionRef } from "./http2/ClientHttp2SessionRef";
/**
 * This class previously implemented the ConnectionManager<ClientHttp2Session> interface,
 * but this class isn't exported from this package, except as a private property of NodeHttp2Handler.
 *
 * @since 4.6.0
 * @internal
 */
export declare class NodeHttp2ConnectionManager implements ConnectionManager<ClientHttp2SessionRef> {
    private config;
    private connectOptions?;
    private readonly connectionPools;
    constructor(config: ConnectionManagerConfiguration);
    /**
     * Acquire a session for making a request.
     */
    lease(requestContext: RequestContext, connectionConfiguration: ConnectConfiguration): ClientHttp2SessionRef;
    /**
     * Signal that a request using this session has completed.
     *
     * The session remains in its pool for reuse.
     * This method is not called for isolated sessions.
     */
    release(_requestContext: RequestContext, ref: ClientHttp2SessionRef): void;
    /**
     * Create an isolated session that isn't part of the connection pools.
     * For use in event-streams or when concurrency is turned off.
     */
    createIsolatedSession(requestContext: RequestContext, connectionConfiguration: ConnectConfiguration): ClientHttp2SessionRef;
    destroy(): void;
    setMaxConcurrentStreams(maxConcurrentStreams: number): void;
    setDisableConcurrentStreams(disableConcurrentStreams: boolean): void;
    setNodeHttp2ConnectOptions(nodeHttp2ConnectOptions: Partial<SecureClientSessionOptions | ClientSessionOptions>): void;
    /**
     * @internal
     * @returns a snapshot of the state of all connection pools and their sessions.
     */
    debug(): Record<string, any>;
    private removeFromPoolAndClose;
    private removeFromPoolAndCheckedDestroy;
    private getPool;
    private getUrlString;
    private connect;
}
