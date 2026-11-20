import type { TransactionalEmail } from "@langwatch/enterprise-nurturing-contract";
import type { SendEmailCommand } from "@langwatch/notification-contract";

import { oneClickUnsubscribeHeaders } from "./email-mime.rules.ts";

/** What becomes of a recipient Customer.io did not accept. */
export type CustomerIoRoute = Readonly<{ fallback: "own-mailer" }>;

const ownMailerFallback: CustomerIoRoute = { fallback: "own-mailer" };

/**
 * The messages LangWatch Cloud sends through Customer.io, by template id; the rest stays on the
 * own mailer. Security mail (verification, reset, invitations, MFA, SSO, licences, statements,
 * operator notices) never belongs here, nor HTML that carries a per-recipient token, a one-click
 * action link or customer content: the trigger digest, the join-request messages, budget requests
 * (the requester's own words) and the paused online evaluation (its top error). Payment recovery
 * waits until main sends it.
 */
export const CUSTOMER_IO_ROUTES: Readonly<Record<string, CustomerIoRoute>> = {
  "invite-re-request": ownMailerFallback,
  "domain-auto-joined": ownMailerFallback,
  "seat-request": ownMailerFallback,
  "usage-limit": ownMailerFallback,
  "automation-limit": ownMailerFallback,
};

/**
 * The Customer.io requests one send becomes, one per recipient (the visible one and every hidden
 * one), or none when the own mailer sends it: an untagged or unrouted template, or a message
 * with attachments, which this route does not carry.
 */
export function findCustomerIoRequests({
  command,
  defaultFrom,
  replyTo,
}: {
  command: SendEmailCommand;
  defaultFrom: string;
  /** The no-reply address a replyless send answers to. */
  replyTo: string | undefined;
}): TransactionalEmail[] {
  const { template } = command;
  if (template === undefined || !Object.hasOwn(CUSTOMER_IO_ROUTES, template)) return [];
  if (command.attachments !== undefined && command.attachments.length > 0) return [];

  return recipientsOf(command).map((recipient) => ({
    transactionalMessageId: template,
    identifiers: { email: bareAddressOf(recipient) },
    to: recipient,
    from: command.from ?? defaultFrom,
    subject: command.subject,
    body: command.html,
    ...(replyTo === undefined ? {} : { replyTo }),
    ...(command.unsubscribe === undefined
      ? {}
      : { headers: oneClickUnsubscribeHeaders(command.unsubscribe.url) }),
  }));
}

/** Everyone the message reaches: the visible recipients, then the hidden ones. */
function recipientsOf(command: SendEmailCommand): string[] {
  return [...[command.to].flat(), ...(command.undisclosedRecipients ?? [])];
}

/**
 * Customer.io files a person under a plain address, never a `Name <address>` form. The address
 * is the angle pair that ends the string: a quoted display name may hold an earlier one.
 */
function bareAddressOf(recipient: string): string {
  return recipient.match(/<([^<>]+)>\s*$/)?.[1]?.trim() ?? recipient.trim();
}
