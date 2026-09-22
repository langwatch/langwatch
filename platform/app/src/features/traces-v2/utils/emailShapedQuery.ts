/**
 * Whether a free-text query carries an email address.
 *
 * Email addresses are redacted before a trace is stored whenever the
 * project's data privacy settings redact PII, which they do by default, so
 * the stored text never holds one and a search for it finds nothing however
 * many traces mention that person. The empty state uses this to say so.
 */
const EMAIL_ADDRESS = /[^\s@<>"']+@[^\s@<>"']+\.[A-Za-z]{2,}/;

export function looksLikeEmail(query: string): boolean {
  return EMAIL_ADDRESS.test(query);
}

/**
 * Whether a project's effective PII policy replaces email addresses before a
 * trace is stored.
 *
 * The essential and strict levels redact every native identifier, so an
 * address never survives them. The custom level redacts only the entities it
 * lists, and a project that left EMAIL_ADDRESS out of that list stores
 * addresses in full: telling it they were redacted would send someone looking
 * for a setting that is already off.
 */
export function redactsEmailAddresses(pii: {
  level: string;
  entities?: string[] | null;
}): boolean {
  if (pii.level === "essential" || pii.level === "strict") return true;
  if (pii.level === "custom") {
    return (pii.entities ?? []).includes("EMAIL_ADDRESS");
  }
  return false;
}
