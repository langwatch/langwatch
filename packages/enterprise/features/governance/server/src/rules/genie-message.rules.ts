// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The Genie wire shapes a pulled message arrives in, and the identity, timing and status derived
 * once per message. Types only, so the mapper and the span builders name the same shapes without
 * either owning the other.
 */

import type { RoutingOrigin } from "../services/conversation-trace-assembly.service";

/**
 * The wire shape (verified against the 35-message capture,
 * 30_genie_messages.raw.jsonl) keys thoughts by `thought_type` with
 * enum-prefixed values ("THOUGHT_TYPE_UNDERSTANDING"); `type`/bare values
 * are tolerated in case the API ever drops the prefix.
 */
export interface GenieThought {
  thought_type?: string;
  type?: string;
  text?: string;
  content?: string;
}

export interface GenieQueryAttachment {
  query?: string | null;
  description?: string | null;
  statement_id?: string | null;
  query_result_metadata?: { row_count?: number | null } | null;
  thoughts?: GenieThought[] | null;
}

export interface GenieAttachment {
  attachment_id?: string;
  query?: GenieQueryAttachment | null;
  text?: { content?: string | null; purpose?: string | null } | null;
  viz?: { query_attachment_id?: string | null } | null;
  suggested_questions?: unknown;
}

/** The raw_payload fields this mapper reads. Everything else passes by. */
export interface GenieMessagePayload {
  message_id?: string;
  conversation_id?: string | null;
  user_id?: number | null;
  content?: string | null;
  status?: string | null;
  created_timestamp?: number | null;
  last_updated_timestamp?: number | null;
  auto_regenerate_count?: number | null;
  attachments?: GenieAttachment[] | null;
}

/** Thought order the capture showed; DESCRIPTION is dropped (duplicate). */
export const THOUGHT_ORDER = ["UNDERSTANDING", "DATA_SOURCING", "STEPS"] as const;
export const DROPPED_THOUGHT_TYPE = "DESCRIPTION";
export const THOUGHT_TYPE_PREFIX = "THOUGHT_TYPE_";

export const MS_THRESHOLD = 1_000_000_000_000;

/** Kept as a name existing callers already import. */
export type GenieRoutingOrigin = RoutingOrigin;

/** Identity, timing, status, and origin derived once per message. */
export interface GenieMessageFrame {
  payload: GenieMessagePayload;
  origin: GenieRoutingOrigin;
  conversationId: string;
  messageId: string;
  regenCount: number;
  traceId: string;
  /** `conversationId` namespaced by source — the explorer's grouping key. */
  threadId: string;
  spanSeed: string;
  rootSpanId: string;
  startMs: number;
  endMs: number;
  status: string;
  isCompleted: boolean;
}
