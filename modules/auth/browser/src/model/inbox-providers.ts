/**
 * The mailboxes most people have, and the door to each. Domains match exactly
 * (after the last "@", case-insensitively), never by suffix: a company's own
 * domain gets no guess, because a wrong guess is a login page for a mailbox
 * the person does not have.
 */
export type InboxProviderId = "gmail" | "outlook" | "yahoo" | "icloud" | "proton" | "aol";

export type InboxProvider = { id: InboxProviderId; url: string };

const GMAIL: InboxProvider = { id: "gmail", url: "https://mail.google.com/" };
const OUTLOOK: InboxProvider = { id: "outlook", url: "https://outlook.live.com/mail/" };
const YAHOO: InboxProvider = { id: "yahoo", url: "https://mail.yahoo.com/" };
const ICLOUD: InboxProvider = { id: "icloud", url: "https://www.icloud.com/mail/" };
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

/** The common provider an address belongs to; empty for anything else. */
export function findInboxProvider({ email }: { email: string }): InboxProvider[] {
  const at = email.lastIndexOf("@");
  if (at < 0) return [];
  const provider =
    INBOX_BY_DOMAIN[
      email
        .slice(at + 1)
        .trim()
        .toLowerCase()
    ];
  return provider ? [provider] : [];
}
