/**
 * Every `presence.*` procedure, declared once: its name, its kind, what it
 * takes and what it answers. The server binds a permission and a handler to a
 * name declared here; the browser reads the same names and schemas as types.
 */

import { defineTrpcContract } from "@langwatch/kernel/contract";

import {
  presenceAcknowledgedSchema,
  presenceCursorEventSchema,
  presenceCursorRequestSchema,
  presenceCursorSubscriptionSchema,
  presenceEventSchema,
  presenceLeaveRequestSchema,
  presenceProjectInputSchema,
  presenceUpdateRequestSchema,
} from "./presence.ts";
import {
  organizationReadHintsInputSchema,
  projectReadHintsInputSchema,
  readHintSchema,
} from "./read-hints.ts";

export const presenceTrpc = defineTrpcContract("presence")
  /** Heartbeat and location for one browser session. */
  .mutation("update")
  .withInput(presenceUpdateRequestSchema)
  .withOutput(presenceAcknowledgedSchema)

  /** Removes a session at once and tells peers, rather than waiting for the TTL. */
  .mutation("leave")
  .withInput(presenceLeaveRequestSchema)
  .withOutput(presenceAcknowledgedSchema)

  /** A high-frequency cursor tick; an exhausted tenant bucket drops it silently. */
  .mutation("cursor")
  .withInput(presenceCursorRequestSchema)
  .withOutput(presenceAcknowledgedSchema)

  /** One snapshot on connect, then join / update / leave deltas. */
  .subscription("onPresenceUpdate")
  .withInput(presenceProjectInputSchema)
  .withOutput(presenceEventSchema)

  /** Peers' cursors on one anchor, never the subscriber's own. */
  .subscription("onPresenceCursor")
  .withInput(presenceCursorSubscriptionSchema)
  .withOutput(presenceCursorEventSchema)

  /** The focused tab's hint stream for an organisation: its user's and organisation's hints. */
  .subscription("onOrganizationReadHints")
  .withInput(organizationReadHintsInputSchema)
  .withOutput(readHintSchema)

  /** The same at project level, with the project's read hints too. */
  .subscription("onProjectReadHints")
  .withInput(projectReadHintsInputSchema)
  .withOutput(readHintSchema)
  .build();
