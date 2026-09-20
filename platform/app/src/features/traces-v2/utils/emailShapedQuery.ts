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
