const ids = new Uint16Array(1);
export class ClientHttp2SessionRef {
    id = ids[0]++;
    total = 0;
    max = 0;
    session;
    refs = 0;
    constructor(session) {
        session.unref();
        this.session = session;
    }
    retain() {
        if (this.session.destroyed) {
            throw new Error("@smithy/node-http-handler - cannot acquire reference to destroyed session.");
        }
        this.refs += 1;
        this.total += 1;
        this.max = Math.max(this.refs, this.max);
        this.session.ref();
    }
    free() {
        if (this.session.destroyed) {
            return;
        }
        this.refs -= 1;
        if (this.refs === 0) {
            this.session.unref();
        }
        if (this.refs < 0) {
            throw new Error("@smithy/node-http-handler - ClientHttp2Session refcount at zero, cannot decrement.");
        }
    }
    deref() {
        return this.session;
    }
    close() {
        if (!this.session.closed) {
            this.session.close();
        }
    }
    destroy() {
        this.refs = 0;
        if (!this.session.destroyed) {
            this.session.destroy();
        }
    }
    useCount() {
        return this.refs;
    }
}
