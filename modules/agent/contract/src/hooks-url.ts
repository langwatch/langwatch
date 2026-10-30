/**
 * A URL as typed up to its path, query or fragment: the scheme and the authority.
 */
const SCHEME_AND_AUTHORITY = /^[^/?#]*(?:\/\/[^/?#]*)?/;

/**
 * Whether a hooks URL has a template (or an encoded brace) in its scheme or authority. Those render
 * per run, so run parameters could send a hook call, with the agent's credentials and signature, to
 * any host; a template in the path or the query cannot move it. Spec: scenario-run-hooks.feature.
 */
export function templatesHooksOrigin(hooksUrl: string | undefined): boolean {
  const schemeAndAuthority = SCHEME_AND_AUTHORITY.exec(hooksUrl?.trim() ?? "")?.[0] ?? "";

  return /\{|%7B/i.test(schemeAndAuthority);
}
