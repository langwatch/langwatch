import http2 from "node:http2";
import { ClientHttp2SessionRef } from "./http2/ClientHttp2SessionRef";
import { NodeHttp2ConnectionPool } from "./node-http2-connection-pool";
export class NodeHttp2ConnectionManager {
    config;
    connectOptions;
    connectionPools = new Map();
    constructor(config) {
        this.config = config;
        if (this.config.maxConcurrency && this.config.maxConcurrency <= 0) {
            throw new RangeError("maxConcurrency must be greater than zero.");
        }
    }
    lease(requestContext, connectionConfiguration) {
        const url = this.getUrlString(requestContext);
        const pool = this.getPool(url);
        if (!this.config.disableConcurrency && !connectionConfiguration.isEventStream) {
            const available = pool.poll();
            if (available) {
                available.retain();
                return available;
            }
        }
        const ref = new ClientHttp2SessionRef(this.connect(url));
        const session = ref.deref();
        if (this.config.maxConcurrency) {
            session.settings({ maxConcurrentStreams: this.config.maxConcurrency }, (err) => {
                if (err) {
                    throw new Error("Fail to set maxConcurrentStreams to " +
                        this.config.maxConcurrency +
                        "when creating new session for " +
                        requestContext.destination.toString());
                }
            });
        }
        const graceful = () => {
            this.removeFromPoolAndClose(url, ref);
        };
        const ensureDestroyed = () => {
            this.removeFromPoolAndCheckedDestroy(url, ref);
        };
        session.on("goaway", graceful);
        session.on("error", ensureDestroyed);
        session.on("frameError", ensureDestroyed);
        session.on("close", ensureDestroyed);
        if (connectionConfiguration.requestTimeout) {
            session.setTimeout(connectionConfiguration.requestTimeout, ensureDestroyed);
        }
        pool.offerLast(ref);
        ref.retain();
        return ref;
    }
    release(_requestContext, ref) {
        ref.free();
    }
    createIsolatedSession(requestContext, connectionConfiguration) {
        const url = this.getUrlString(requestContext);
        const ref = new ClientHttp2SessionRef(this.connect(url));
        const session = ref.deref();
        session.settings({ maxConcurrentStreams: 1 });
        const ensureDestroyed = () => {
            ref.destroy();
        };
        session.on("error", ensureDestroyed);
        session.on("frameError", ensureDestroyed);
        session.on("close", ensureDestroyed);
        if (connectionConfiguration.requestTimeout) {
            session.setTimeout(connectionConfiguration.requestTimeout, ensureDestroyed);
        }
        ref.retain();
        return ref;
    }
    destroy() {
        for (const [url, connectionPool] of this.connectionPools) {
            for (const session of [...connectionPool]) {
                session.destroy();
            }
            this.connectionPools.delete(url);
        }
    }
    setMaxConcurrentStreams(maxConcurrentStreams) {
        if (maxConcurrentStreams && maxConcurrentStreams <= 0) {
            throw new RangeError("maxConcurrentStreams must be greater than zero.");
        }
        this.config.maxConcurrency = maxConcurrentStreams;
        for (const pool of this.connectionPools.values()) {
            pool.setMaxConcurrency(maxConcurrentStreams);
        }
    }
    setDisableConcurrentStreams(disableConcurrentStreams) {
        this.config.disableConcurrency = disableConcurrentStreams;
    }
    setNodeHttp2ConnectOptions(nodeHttp2ConnectOptions) {
        this.connectOptions = nodeHttp2ConnectOptions;
    }
    debug() {
        const pools = {};
        for (const [url, pool] of this.connectionPools) {
            const sessions = [];
            for (const ref of pool) {
                sessions.push({
                    id: ref.id,
                    active: ref.useCount(),
                    maxConcurrent: ref.max,
                    totalRequests: ref.total,
                });
            }
            pools[url] = { sessions };
        }
        return pools;
    }
    removeFromPoolAndClose(authority, ref) {
        this.connectionPools.get(authority)?.remove(ref);
        ref.close();
    }
    removeFromPoolAndCheckedDestroy(authority, ref) {
        this.connectionPools.get(authority)?.remove(ref);
        ref.destroy();
    }
    getPool(url) {
        if (!this.connectionPools.has(url)) {
            const pool = new NodeHttp2ConnectionPool();
            if (this.config.maxConcurrency) {
                pool.setMaxConcurrency(this.config.maxConcurrency);
            }
            this.connectionPools.set(url, pool);
        }
        return this.connectionPools.get(url);
    }
    getUrlString(request) {
        return request.destination.toString();
    }
    connect(url) {
        return this.connectOptions === undefined ? http2.connect(url) : http2.connect(url, this.connectOptions);
    }
}
