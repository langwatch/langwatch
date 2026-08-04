/**
 * Wire contracts for the agent-onboarding RPC service — the anonymous
 * provisioning front door and the claim flow that turns a temporary account
 * into a real one.
 *
 * Schemas only. No transport, no Prisma, no environment: the same file
 * describes the server's validation and, when a client is written against it,
 * the client's expectations.
 */
export * from "./claim.js";
export * from "./passkey.js";
export * from "./primitives.js";
export * from "./provision.js";
