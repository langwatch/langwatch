import type { TransactionalEmail } from "@langwatch/enterprise-nurturing-contract";
import type { SendEmailCommand } from "@langwatch/notification-contract";

/**
 * Templates LangWatch Cloud sends through Customer.io; the rest stays on the own mailer. Never
 * security mail, a per-recipient token, a one-click action link, customer content or a third
 * party's address. Exclusions: modules/notification/README.md, "Customer.io on LangWatch Cloud".
 */
export const CUSTOMER_IO_ROUTES: ReadonlySet<string> = new Set([
  "join-request-arrived",
  "join-request-reminder",
  "join-request-approved",
  "join-request-rejected",
  "join-request-expired",
  "domain-auto-joined",
  "usage-limit",
  "automation-limit",
]);

/**
 * The Customer.io requests one send becomes, one per recipient (the visible one and every hidden
 * one), or none when the own mailer sends it: an untagged or unrouted template, or a message
 * with attachments or a one-click unsubscribe token, which this route does not carry.
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
  if (template === undefined || !CUSTOMER_IO_ROUTES.has(template)) return [];
  if (command.attachments !== undefined && command.attachments.length > 0) return [];
  // Its one-click token is per recipient and must not leave for Customer.io.
  if (command.unsubscribe !== undefined) return [];

  return recipientsOf(command).map((recipient) => ({
    transactionalMessageId: template,
    identifiers: { email: bareAddressOf(recipient) },
    to: recipient,
    from: command.from ?? defaultFrom,
    subject: command.subject,
    body: command.html,
    ...(replyTo === undefined ? {} : { replyTo }),
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
