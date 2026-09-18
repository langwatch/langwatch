"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpeechEngineAttachment = void 0;
/**
 * Returned by `engine.attach()`. Call `.close()` to stop accepting connections
 * without affecting the HTTP server.
 */
class SpeechEngineAttachment {
    /** @internal */
    constructor(wss, httpServer, upgradeListener) {
        this.wss = wss;
        this.httpServer = httpServer !== null && httpServer !== void 0 ? httpServer : null;
        this.upgradeListener = upgradeListener !== null && upgradeListener !== void 0 ? upgradeListener : null;
    }
    /**
     * Stop accepting new connections, remove the upgrade listener from the HTTP
     * server, and close the underlying WebSocket server.
     * Does not affect the HTTP server the attachment was created from.
     */
    close() {
        if (this.httpServer && this.upgradeListener) {
            this.httpServer.removeListener("upgrade", this.upgradeListener);
        }
        return new Promise((resolve, reject) => {
            this.wss.close((err) => {
                if (err)
                    reject(err);
                else
                    resolve();
            });
        });
    }
}
exports.SpeechEngineAttachment = SpeechEngineAttachment;
