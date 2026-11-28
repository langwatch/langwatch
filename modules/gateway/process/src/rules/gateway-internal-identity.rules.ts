/**
 * How far a signed request's timestamp may drift. The signature itself is
 * `@langwatch/process/gateway-internal-signature`, the one every app-side signer uses.
 */
export const GATEWAY_SIGNATURE_WINDOW_SECONDS = 300;
