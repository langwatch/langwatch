// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** One Genie message, its space and conversation, and its author, as the visibility record. */

import { PULLED_USAGE_HINT_KEY } from "@langwatch/enterprise-governance-contract";
import type { NormalizedPullEvent } from "@langwatch/enterprise-governance-contract";
import { Temporal } from "@langwatch/time";
import { z } from "zod";

import type { GenieSpace } from "./genie-spaces.rules.ts";

/** The ledger's model label. Genie is one product, not a family of models. */
const GENIE_MODEL = "databricks/genie" as const;

export const spaceSchema = z
  .object({
    space_id: z.string(),
    title: z.string().nullable().default(null),
  })
  .passthrough();

export const conversationSchema = z
  .object({
    conversation_id: z.string(),
    title: z.string().nullable().default(null),
    created_timestamp: z.number().nullable().default(null),
  })
  .passthrough();

export const conversationsPageSchema = z.object({
  conversations: z.array(conversationSchema).default([]),
  next_page_token: z.string().nullable().default(null),
});

/**
 * One Genie message. `attachments` is a union in the wire format — a text
 * reply, a generated query, a set of suggested follow-ups, a visualisation —
 * so everything but the id is optional and unknown members pass through.
 */
const attachmentSchema = z
  .object({
    attachment_id: z.string().optional(),
    query: z
      .object({
        query: z.string().nullable().default(null),
        description: z.string().nullable().default(null),
        statement_id: z.string().nullable().default(null),
        query_result_metadata: z
          .object({ row_count: z.number().nullable().default(null) })
          .passthrough()
          .nullable()
          .default(null),
      })
      .passthrough()
      .optional(),
    text: z
      .object({ content: z.string().nullable().default(null) })
      .passthrough()
      .optional(),
  })
  .passthrough();

const messageSchema = z
  .object({
    message_id: z.string(),
    conversation_id: z.string().nullable().default(null),
    space_id: z.string().nullable().default(null),
    /** Databricks' numeric account id for the author. Immutable. */
    user_id: z.number().nullable().default(null),
    /** The question, as the user typed it. */
    content: z.string().nullable().default(null),
    status: z.string().nullable().default(null),
    created_timestamp: z.number().nullable().default(null),
    attachments: z.array(attachmentSchema).nullable().default(null),
  })
  .passthrough();

export const messagesPageSchema = z.object({
  messages: z.array(messageSchema).default([]),
  next_page_token: z.string().nullable().default(null),
});

export const scimUserSchema = z
  .object({
    userName: z.string().nullable().default(null),
    externalId: z.string().nullable().default(null),
    displayName: z.string().nullable().default(null),
  })
  .passthrough();

/** Who asked, resolved once per run and reused across every message. */
export interface GenieIdentity {
  /**
   * The stable identity key: the IdP's object id when the directory carries
   * one, the login name otherwise. `externalId` is written once at account
   * creation and is absent for accounts provisioned before SCIM was wired, so
   * it cannot be the sole key — an adapter that insisted on it would attribute
   * a real person's activity to nobody.
   */
  key: string;
  /** The email-shaped login, which is what `actor` means everywhere else. */
  email: string;
  externalId: string;
  displayName: string;
}

export const UNKNOWN_IDENTITY: GenieIdentity = {
  key: "",
  email: "",
  externalId: "",
  displayName: "",
};

/**
 * The identity for a parsed SCIM user. Key precedence: the IdP object id when
 * the directory carries one, else the login email, else the raw numeric id —
 * see the `GenieIdentity.key` note for why `externalId` cannot stand alone.
 */
export function genieIdentityFromScimUser(
  user: z.infer<typeof scimUserSchema>,
  userId: number,
): GenieIdentity {
  const email = user.userName ?? "";
  const externalId = user.externalId ?? "";
  return {
    key: externalId || email || String(userId),
    email,
    externalId,
    displayName: user.displayName ?? "",
  };
}

/**
 * One message → one visibility record.
 *
 * The dimensions are the message's own coordinates and nothing else. Not the
 * author: identity resolution can change between pulls (a backfilled
 * `externalId`, a renamed account) and an author in the key would mint a
 * SECOND record for a message that has not changed. Not the space title
 * either, for the same reason — it is a label an admin can edit.
 */
export function messageEvent({
  message,
  space,
  conversation,
  createdMs,
  identity,
}: {
  message: z.infer<typeof messageSchema>;
  space: GenieSpace;
  conversation: z.infer<typeof conversationSchema>;
  createdMs: number;
  identity: GenieIdentity;
}): NormalizedPullEvent {
  const generated = message.attachments?.find((a) => a.query?.query);
  const dimensions = {
    spaceId: space.space_id,
    conversationId: conversation.conversation_id,
    messageId: message.message_id,
  };

  return {
    source_event_id: message.message_id,
    event_timestamp: Temporal.Instant.fromEpochMilliseconds(createdMs).toString({
      fractionalSecondDigits: 3,
    }),
    // The login when the directory has one, the identity key otherwise. An
    // account with no `userName` still has an object id or a numeric id, and
    // an empty `actor` would drop it out of every actor-filtered SIEM view —
    // present-but-not-an-email beats absent.
    actor: identity.email || identity.key,
    action: "genie_query",
    target: space.title ?? space.space_id,
    // No amount at the point the message is built — not zero. Genie bills
    // nothing per message, and the warehouse compute behind it is not on
    // this API; a source that names a warehouse has that share attached
    // afterwards, once the run's billing read has answered (see
    // `withWarehouseCost`). Until then there is no bill to back a figure,
    // and a zero here is indistinguishable from a question that genuinely
    // cost nothing: the record seam reads `cost_usd` as the reported amount
    // when the hint names none, so a "0" would land on the ledger as a
    // measurement.
    tokens_input: 0,
    tokens_output: 0,
    raw_payload: JSON.stringify(message),
    extra: {
      spaceId: space.space_id,
      spaceTitle: space.title ?? "",
      conversationId: conversation.conversation_id,
      conversationTitle: conversation.title ?? "",
      messageId: message.message_id,
      status: message.status ?? "",
      // The two artefacts this adapter exists to surface.
      question: message.content ?? "",
      generatedSql: generated?.query?.query ?? "",
      statementId: generated?.query?.statement_id ?? "",
      rowCount: generated?.query?.query_result_metadata?.row_count ?? null,
      // The resolved author, all three forms. `actorKey` is the one to join
      // on; the other two are what a human reads.
      actorKey: identity.key,
      actorEmail: identity.email,
      actorExternalId: identity.externalId,
      actorDisplayName: identity.displayName,
      actorUserId: message.user_id === null ? "" : String(message.user_id),
      [PULLED_USAGE_HINT_KEY]: {
        costBasis: "provider_reported",
        // Never `exact`. The figure, when one is attached, is a share of an
        // hourly bill worked out from LIST prices, because the account's
        // negotiated rate is on no table this token can read.
        costStatus: "estimate",
        // No `costUsd` here, deliberately. The hint declares the message a
        // cost item and names its coordinates; the amount is attached by
        // `withCost` once the warehouse bill has answered, and a
        // provider-reported hint with no amount is one the record seam
        // declines to price — an unpriced question, never a zero one. A
        // source that names no warehouse has no bill to attach and stays
        // unpriced for good, which is the honest figure for it.
        dimensions,
        // The space IS the agent here — the configured thing people talk to
        // (#7881). Same value as `dimensions.spaceId`, deliberately: the
        // record seam keeps the agent out of the restatement key, and the
        // rollup's AgentId column gets it from this field alone.
        agentId: space.space_id,
        model: GENIE_MODEL,
      },
    },
  };
}
