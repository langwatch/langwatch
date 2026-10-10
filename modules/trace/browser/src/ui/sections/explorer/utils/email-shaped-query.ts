/**
 * Whether a free-text query carries an email address. PII redaction replaces
 * addresses before storage, so a search for one finds nothing.
 * @see specs/traces-v2/email-search-redaction-notice.feature
 */
const EMAIL_ADDRESS = /[^\s@<>"']+@[^\s@<>"']+\.[A-Za-z]{2,}/;

export function looksLikeEmail(query: string): boolean {
  return EMAIL_ADDRESS.test(query);
}

/**
 * Whether a project's effective PII policy replaces email addresses before
 * storage: essential and strict always do; custom only when it lists them.
 */
export function redactsEmailAddresses(pii: { level: string; entities?: string[] | null }): boolean {
  if (pii.level === "essential" || pii.level === "strict") return true;
  if (pii.level === "custom") {
    return (pii.entities ?? []).includes("EMAIL_ADDRESS");
  }
  return false;
}
