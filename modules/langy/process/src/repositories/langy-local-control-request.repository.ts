import { z } from "zod";

import type { LocalRecordLookup } from "./langy-local-call.repository.ts";

/** One control request, from the card that asked to the approval that spends it. */
export const storedControlRequestSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  conversationTitle: z.string(),
  conversationUrl: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  userId: z.string(),
  createdAt: z.number(),
  expiresAt: z.number(),
  command: z.string(),
});
export type StoredControlRequest = z.infer<typeof storedControlRequestSchema>;

/** What the socket reads to know which conversation a key answers for. */
export const sessionKeyBindingSchema = z.object({
  conversationId: z.string(),
  projectId: z.string(),
  userId: z.string(),
  requestId: z.string(),
});
export type SessionKeyBinding = z.infer<typeof sessionKeyBindingSchema>;

/**
 * The control requests that bind a folder to a conversation (ADR-129): each
 * request, each user's open set, the single-use claim, and the binding of a
 * minted key to its conversation. Every write carries its expiry.
 */
export abstract class LangyLocalControlRequestRepository {
  abstract saveRequest(input: { request: StoredControlRequest; ttlSeconds: number }): Promise<void>;

  /** Puts the request in its user's open set, scored by its expiry. */
  abstract indexOpenRequest(input: {
    userId: string;
    requestId: string;
    expiresAt: number;
    ttlSeconds: number;
  }): Promise<void>;

  /** Drops every open request of the user scored at or before `lapsedAt`. */
  abstract dropLapsedRequests(input: { userId: string; lapsedAt: number }): Promise<void>;

  /** The user's open request ids scored at or after `from`, soonest first. */
  abstract findOpenRequestIds(input: { userId: string; from: number }): Promise<string[]>;

  /** The request's record; `miss` once it has expired. */
  abstract findRequest(requestId: string): Promise<LocalRecordLookup<StoredControlRequest>>;

  /** Deletes the request and takes it out of its user's open set. */
  abstract forgetRequest(input: { requestId: string; userId: string }): Promise<void>;

  /** Spends the request; false when another approval already did. */
  abstract claimRequest(input: {
    requestId: string;
    userId: string;
    ttlSeconds: number;
  }): Promise<boolean>;

  abstract isClaimed(requestId: string): Promise<boolean>;

  abstract saveKeyBinding(input: {
    apiKeyId: string;
    binding: SessionKeyBinding;
    ttlSeconds: number;
  }): Promise<void>;

  /** Puts the key in its conversation's binding set, scored by when the binding lapses. */
  abstract indexKeyBinding(input: {
    conversationId: string;
    apiKeyId: string;
    lapsesAt: number;
    ttlSeconds: number;
  }): Promise<void>;

  /** The key's binding; `miss` once it has expired. */
  abstract findKeyBinding(apiKeyId: string): Promise<LocalRecordLookup<SessionKeyBinding>>;

  abstract deleteKeyBinding(apiKeyId: string): Promise<void>;

  abstract unindexKeyBinding(input: { conversationId: string; apiKeyId: string }): Promise<void>;

  /** Every key id in the conversation's binding set. */
  abstract findKeyBindingIds(conversationId: string): Promise<string[]>;
}
