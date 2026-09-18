import { ClientHttp2SessionRef } from "./http2/ClientHttp2SessionRef";
export class NodeHttp2ConnectionPool {
    sessions = [];
    maxConcurrency = 0;
    constructor(sessions) {
        this.sessions = (sessions ?? []).map((session) => new ClientHttp2SessionRef(session));
    }
    poll() {
        let cleanup = false;
        for (const session of this.sessions) {
            if (session.deref().destroyed) {
                cleanup = true;
                continue;
            }
            if (!this.maxConcurrency || session.useCount() < this.maxConcurrency) {
                return session;
            }
        }
        if (cleanup) {
            for (const session of this.sessions) {
                if (session.deref().destroyed) {
                    this.remove(session);
                }
            }
        }
    }
    offerLast(ref) {
        this.sessions.push(ref);
    }
    remove(ref) {
        const ix = this.sessions.indexOf(ref);
        if (ix > -1) {
            this.sessions.splice(ix, 1);
        }
    }
    [Symbol.iterator]() {
        return this.sessions[Symbol.iterator]();
    }
    setMaxConcurrency(maxConcurrency) {
        this.maxConcurrency = maxConcurrency;
    }
    destroy(ref) {
        this.remove(ref);
        ref.destroy();
    }
}
