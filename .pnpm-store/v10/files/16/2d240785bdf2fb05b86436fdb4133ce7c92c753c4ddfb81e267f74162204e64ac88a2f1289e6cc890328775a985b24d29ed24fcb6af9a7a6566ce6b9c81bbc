"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebhooksClient = void 0;
const crypto_1 = require("crypto");
const errors_1 = require("../errors");
const Client_1 = require("../api/resources/webhooks/client/Client");
const crypto = (_a = globalThis.crypto) !== null && _a !== void 0 ? _a : crypto_1.webcrypto;
// Async HMAC-SHA256 using Web Crypto API
function hmacSHA256(key, message) {
    return __awaiter(this, void 0, void 0, function* () {
        const enc = new TextEncoder();
        const keyData = enc.encode(key);
        const msgData = enc.encode(message);
        const cryptoKey = yield crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
        const sig = yield crypto.subtle.sign("HMAC", cryptoKey, msgData);
        return ("v0=" +
            Array.from(new Uint8Array(sig))
                .map((b) => b.toString(16).padStart(2, "0"))
                .join(""));
    });
}
/**
 * Extended webhook client that includes both auto-generated API methods and custom functionality
 */
class WebhooksClient extends Client_1.WebhooksClient {
    /**
     * Constructs a webhook event object from a payload and signature.
     * Verifies the webhook signature to ensure the event came from ElevenLabs.
     *
     * @param rawBody - The webhook request body. Must be the raw body, not a JSON object
     * @param sigHeader - The signature header from the request
     * @param secret - Your webhook secret
     * @returns The verified webhook event
     * @throws {ElevenLabsError} if the signature is invalid or missing
     */
    constructEvent(rawBody, sigHeader, secret) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            if (!sigHeader) {
                throw new errors_1.ElevenLabsError({
                    message: "Missing signature header",
                    statusCode: 400,
                });
            }
            if (!secret) {
                throw new errors_1.ElevenLabsError({
                    message: "Webhook secret not configured",
                    statusCode: 400,
                });
            }
            const headers = sigHeader.split(",");
            const timestamp = (_a = headers.find((e) => e.startsWith("t="))) === null || _a === void 0 ? void 0 : _a.substring(2);
            const signature = headers.find((e) => e.startsWith("v0="));
            if (!timestamp || !signature) {
                throw new errors_1.ElevenLabsError({
                    message: "No signature hash found with expected scheme v0",
                    statusCode: 400,
                });
            }
            // Validate timestamp
            const reqTimestamp = Number(timestamp) * 1000;
            const tolerance = Date.now() - 30 * 60 * 1000;
            if (reqTimestamp < tolerance) {
                throw new errors_1.ElevenLabsError({
                    message: "Timestamp outside the tolerance zone",
                    statusCode: 400,
                });
            }
            // Validate hash
            const message = `${timestamp}.${rawBody}`;
            const digest = yield hmacSHA256(secret, message);
            if (signature !== digest) {
                throw new errors_1.ElevenLabsError({
                    message: "Signature hash does not match the expected signature hash for payload",
                    statusCode: 400,
                });
            }
            return JSON.parse(rawBody);
        });
    }
}
exports.WebhooksClient = WebhooksClient;
