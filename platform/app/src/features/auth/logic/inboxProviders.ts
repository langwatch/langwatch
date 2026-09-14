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
const INBOX_BY_DOMAIN: Record<string, string> = {
  // Google
  "gmail.com": "https://mail.google.com/",
  "googlemail.com": "https://mail.google.com/",
  // Microsoft
  "outlook.com": "https://outlook.live.com/mail/",
  "hotmail.com": "https://outlook.live.com/mail/",
  "live.com": "https://outlook.live.com/mail/",
  "msn.com": "https://outlook.live.com/mail/",
  // Yahoo
  "yahoo.com": "https://mail.yahoo.com/",
  "ymail.com": "https://mail.yahoo.com/",
  // Apple
  "icloud.com": "https://www.icloud.com/mail/",
  "me.com": "https://www.icloud.com/mail/",
  "mac.com": "https://www.icloud.com/mail/",
  // Proton
  "proton.me": "https://mail.proton.me/",
  "protonmail.com": "https://mail.proton.me/",
  "pm.me": "https://mail.proton.me/",
  // AOL
  "aol.com": "https://mail.aol.com/",
};

/**
 * The inbox address for a common mail provider, or null when the domain is
 * not one — which is the answer for every company domain, every hosted
 * custom domain, and anything that does not parse as an address at all.
 */
export function inboxUrlFor({ email }: { email: string }): string | null {
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const domain = email
    .slice(at + 1)
    .trim()
    .toLowerCase();
  return INBOX_BY_DOMAIN[domain] ?? null;
}
