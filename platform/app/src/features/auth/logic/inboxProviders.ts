/**
 * The mailboxes most people have, and the door to each.
 *
 * The check-your-email card tells somebody to go somewhere else; for the
 * domains everyone recognizes it can also open that door. The list is only
 * providers whose inbox lives at one well-known address — a company's own
 * domain gets no guess, because guessing wrong sends a person to a login
 * page for a mailbox they do not have.
 *
 * Domains are matched exactly (after the last "@", case-insensitively),
 * never by suffix: mail hosted AT a provider under a custom domain is
 * indistinguishable from a company's own server, so it gets no door either.
 */
/**
 * Which mailbox a door leads to, named so the card can draw its mark.
 *
 * One id per provider rather than per domain, because `hotmail.com` and
 * `live.com` are the same mailbox wearing older names and a person who
 * recognizes the logo does not care which of them they signed up under.
 */
export type InboxProviderId =
  | "gmail"
  | "outlook"
  | "yahoo"
  | "icloud"
  | "proton"
  | "aol";

export type InboxProvider = {
  id: InboxProviderId;
  /** Where the door goes. */
  url: string;
};

const GMAIL: InboxProvider = { id: "gmail", url: "https://mail.google.com/" };
const OUTLOOK: InboxProvider = {
  id: "outlook",
  url: "https://outlook.live.com/mail/",
};
const YAHOO: InboxProvider = { id: "yahoo", url: "https://mail.yahoo.com/" };
const ICLOUD: InboxProvider = {
  id: "icloud",
  url: "https://www.icloud.com/mail/",
};
const PROTON: InboxProvider = { id: "proton", url: "https://mail.proton.me/" };
const AOL: InboxProvider = { id: "aol", url: "https://mail.aol.com/" };

const INBOX_BY_DOMAIN: Record<string, InboxProvider> = {
  "gmail.com": GMAIL,
  "googlemail.com": GMAIL,
  "outlook.com": OUTLOOK,
  "hotmail.com": OUTLOOK,
  "live.com": OUTLOOK,
  "msn.com": OUTLOOK,
  "yahoo.com": YAHOO,
  "ymail.com": YAHOO,
  "icloud.com": ICLOUD,
  "me.com": ICLOUD,
  "mac.com": ICLOUD,
  "proton.me": PROTON,
  "protonmail.com": PROTON,
  "pm.me": PROTON,
  "aol.com": AOL,
};

/**
 * The common mail provider an address belongs to, or null when the domain is
 * not one — which is the answer for every company domain, every hosted
 * custom domain, and anything that does not parse as an address at all.
 */
export function inboxProviderFor({
  email,
}: {
  email: string;
}): InboxProvider | null {
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const domain = email
    .slice(at + 1)
    .trim()
    .toLowerCase();
  return INBOX_BY_DOMAIN[domain] ?? null;
}
