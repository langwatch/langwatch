"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenAIRealtimeEmitter = exports.OpenAIRealtimeError = void 0;
exports.isAzure = isAzure;
exports.buildRealtimeURL = buildRealtimeURL;
exports.getAzureRealtimeConnection = getAzureRealtimeConnection;
const EventEmitter_1 = require("../lib/EventEmitter.js");
const error_1 = require("../error.js");
const index_1 = require("../index.js");
class OpenAIRealtimeError extends error_1.OpenAIError {
    constructor(message, event) {
        super(message);
        this.error = event?.error;
        this.event_id = event?.event_id;
    }
}
exports.OpenAIRealtimeError = OpenAIRealtimeError;
class OpenAIRealtimeEmitter extends EventEmitter_1.EventEmitter {
    _onError(event, message, cause) {
        message =
            event?.error ?
                `${event.error.message} code=${event.error.code} param=${event.error.param} type=${event.error.type} event_id=${event.error.event_id}`
                : message ?? 'unknown error';
        if (!this._hasListener('error')) {
            const error = new OpenAIRealtimeError(message +
                `\n\nTo resolve these unhandled rejection errors you should bind an \`error\` callback, e.g. \`rt.on('error', (error) => ...)\` `, event);
            // @ts-ignore
            error.cause = cause;
            Promise.reject(error);
            return;
        }
        const error = new OpenAIRealtimeError(message, event);
        // @ts-ignore
        error.cause = cause;
        this._emit('error', error);
    }
}
exports.OpenAIRealtimeEmitter = OpenAIRealtimeEmitter;
function isAzure(client) {
    return client instanceof index_1.AzureOpenAI;
}
function buildRealtimeURL(client, connection) {
    const config = typeof connection === 'string' ? { model: connection } : connection;
    const baseURL = client.baseURL;
    const azure = isAzure(client);
    const hasModel = !!config.model;
    const hasCallID = !!config.callID;
    if (hasModel === hasCallID) {
        throw new Error('Pass exactly one of `model` or `callID` when opening a Realtime WebSocket.');
    }
    let url;
    if (azure && hasCallID) {
        url = new URL(baseURL);
        const basePath = url.pathname.replace(/\/+/g, '/').replace(/\/+$/, '');
        const versionedPath = basePath.endsWith('/v1') ? basePath : `${basePath}/v1`;
        url.pathname = `${versionedPath}/realtime`;
        url.search = '';
        url.hash = '';
    }
    else {
        const path = '/realtime';
        url = new URL(baseURL + (baseURL.endsWith('/') ? path.slice(1) : path));
    }
    url.protocol = 'wss';
    // Sideband control connections attach to an existing call via `call_id`.
    if (azure) {
        if (hasCallID) {
            url.searchParams.set('call_id', config.callID);
        }
        else {
            url.searchParams.set('api-version', client.apiVersion);
            url.searchParams.set('deployment', config.model);
        }
    }
    else {
        if (hasCallID) {
            url.searchParams.set('call_id', config.callID);
        }
        else {
            url.searchParams.set('model', config.model);
        }
    }
    return url;
}
function getAzureRealtimeConnection(client, connection) {
    if (connection.callID !== undefined) {
        if (connection.deploymentName !== undefined) {
            throw new Error('Pass either `deploymentName` or `callID`, but not both.');
        }
        return { callID: connection.callID };
    }
    const model = connection.deploymentName ?? client.deploymentName;
    if (!model) {
        throw new Error('No deployment name provided');
    }
    return { model };
}
//# sourceMappingURL=internal-base.js.map