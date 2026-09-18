import type { ClientHttp2Session } from "node:http2";
/**
 * Shared access ref counter for ClientHttp2Session, where owners are
 * in-flight requests.
 *
 * @internal
 * @since 4.6.0
 */
export declare class ClientHttp2SessionRef {
    readonly id: number;
    /**
     * Total calls to retain for this session.
     */
    total: number;
    /**
     * Max ref count observed.
     */
    max: number;
    private readonly session;
    private refs;
    constructor(session: ClientHttp2Session);
    /**
     * Signal that the session is entering a request span and has an additional owning request.
     * This must be called when beginning a request using the session.
     */
    retain(): void;
    /**
     * Release reference to session, to be called when it exits request span, indicating one fewer owning request.
     * When reaching zero, the session is unref'd.
     * This must be called when concluding a request using the session.
     */
    free(): void;
    /**
     * Access the session (don't call ref/unref on it).
     */
    deref(): ClientHttp2Session;
    /**
     * Allow open refs to free on their own.
     */
    close(): void;
    destroy(): void;
    /**
     * @returns the current number of active references (in-flight requests).
     */
    useCount(): number;
}
