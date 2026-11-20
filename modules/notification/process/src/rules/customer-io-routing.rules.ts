import type { TransactionalEmail } from "@langwatch/enterprise-nurturing-contract";
import type { SendEmailCommand } from "@langwatch/notification-contract";

import { oneClickUnsubscribeHeaders } from "./email-mime.rules.ts";

/** What becomes of a recipient Customer.io did not accept. */
export type CustomerIoRoute = Readonly<{ fallback: "own-mailer" }>;

const ownMailerFallback: CustomerIoRoute = { fallback: "own-mailer" };

/**
 * The messages LangWatch Cloud sends through Customer.io, by template id. Everything else stays
 * on the own mailer. Security mail (sign-up verification, password reset, address confirmation,
 * invitations, MFA, SSO, licences, statements, operator notices) never belongs here.
 * Payment recovery waits until something on main sends it.
 */
export const CUSTOMER_IO_ROUTES: Readonly<Record<string, CustomerIoRoute>> = {
  "invite-re-request": ownMailerFallback,
  "join-request-arrived": ownMailerFallback,
  "join-request-reminder": ownMailerFallback,
  "join-request-approved": ownMailerFallback,
  "join-request-rejected": ownMailerFallback,
  "join-request-expired": ownMailerFallback,
  "domain-auto-joined": ownMailerFallback,
  "seat-request": ownMailerFallback,
  "usage-limit": ownMailerFallback,
  "budget-increase-request": ownMailerFallback,
  "automation-limit": ownMailerFallback,
  "trigger-digest": ownMailerFallback,
  "monitor-auto-paused": ownMailerFallback,
};

/**
 * The Customer.io requests one send becomes, one per recipient (the visible one and every hidden
 * one), or undefined when the own mailer sends it: an untagged or unrouted template, or a message
 * with attachments, which this route does not carry.
 */
export function customerIoRequestsFor({
  command,
  defaultFrom,
  replyTo,
}: {
  command: SendEmailCommand;
  defaultFrom: string;
  /** The no-reply address a replyless send answers to. */
  replyTo: string | undefined;
}): TransactionalEmail[] | undefined {
  const { template } = command;
  if (template === undefined || !Object.hasOwn(CUSTOMER_IO_ROUTES, template)) return undefined;
  if (command.attachments !== undefined && command.attachments.length > 0) return undefined;

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

/** Customer.io files a person under a plain address, never a `Name <address>` form. */
function bareAddressOf(recipient: string): string {
  return recipient.match(/<([^>]+)>/)?.[1]?.trim() ?? recipient.trim();
}
