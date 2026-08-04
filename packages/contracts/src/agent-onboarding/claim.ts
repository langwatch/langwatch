import { z } from "zod";
import { accountRefSchema, agentSlugSchema } from "./primitives.js";

/**
 * PKCE, RFC 7636. Only S256 is offered: `plain` puts the verifier itself in
 * the request, which defeats the reason the code can safely ride in a URL
 * that gets pasted into chat or logged by a browser.
 */
export const codeChallengeMethodSchema = z.literal("S256");

/** Base64url, no padding — the encoding RFC 7636 specifies for both halves. */
const base64Url = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/, "must be unpadded base64url");

export const codeVerifierSchema = base64Url.min(43).max(128);
export const codeChallengeSchema = base64Url.min(43).max(128);

/** `POST /claim/handoff` — the CLI starts a browser round-trip. */
export const claimHandoffStartRequestSchema = z.object({
  claimToken: z.string(),
  codeChallenge: codeChallengeSchema,
  codeChallengeMethod: codeChallengeMethodSchema,
});
export type ClaimHandoffStartRequest = z.infer<
  typeof claimHandoffStartRequestSchema
>;

export const claimHandoffStartResponseSchema = z.object({
  handoffCode: z.string(),
  /** Short, human-readable confirmation string shown on both sides. */
  userCode: z.string(),
  /** What the CLI prints, opens, and renders as a QR code. */
  claimUrl: z.string().url(),
  expiresAt: z.string().datetime(),
  pollIntervalSeconds: z.number().int().positive(),
});
export type ClaimHandoffStartResponse = z.infer<
  typeof claimHandoffStartResponseSchema
>;

/**
 * `GET /claim/handoff/:code` — what the browser page needs to explain the
 * handoff to a human. Deliberately no claim token and no ingestion key: the
 * page renders a decision, it does not need the capability behind it.
 */
export const claimHandoffDescribeResponseSchema = z.object({
  userCode: z.string(),
  projectName: z.string(),
  agent: agentSlugSchema,
  provisionedAt: z.string().datetime(),
  claimableUntil: z.string().datetime(),
  expiresAt: z.string().datetime(),
});
export type ClaimHandoffDescribeResponse = z.infer<
  typeof claimHandoffDescribeResponseSchema
>;

/** What both the browser approval and the CLI's direct claim settle into. */
export const claimResultSchema = z.object({
  account: accountRefSchema,
  claimedAt: z.string().datetime(),
});
export type ClaimResult = z.infer<typeof claimResultSchema>;

/** `POST /claim/handoff/:code/approve` — the signed-in browser approves. */
export const claimHandoffApproveResponseSchema = claimResultSchema;

/** `POST /claim/exchange` — the CLI's poll, proving it started the handoff. */
export const claimExchangeRequestSchema = z.object({
  handoffCode: z.string(),
  codeVerifier: codeVerifierSchema,
});
export type ClaimExchangeRequest = z.infer<typeof claimExchangeRequestSchema>;

/**
 * Pending is a 200, not an error: it is the expected answer for most of the
 * poll's life, and a CLI that has to distinguish "not yet" from "broken" by
 * status code gets it wrong the first time the network hiccups.
 */
export const claimExchangeResponseSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("pending"),
    pollIntervalSeconds: z.number().int().positive(),
  }),
  z.object({
    status: z.literal("approved"),
    result: claimResultSchema,
  }),
]);
export type ClaimExchangeResponse = z.infer<typeof claimExchangeResponseSchema>;

/** `POST /claim/direct` — a CLI that already carries an identity. */
export const claimDirectRequestSchema = z.object({
  claimToken: z.string(),
});
export type ClaimDirectRequest = z.infer<typeof claimDirectRequestSchema>;
