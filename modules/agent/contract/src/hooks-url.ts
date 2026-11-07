/**
 * The WHATWG URL parser, global in Node and browsers alike. This package compiles without DOM or
 * Node types so it stays importable from both, so the part used here is declared.
 */
declare const URL: new (input: string) => {
  protocol: string;
  username: string;
  password: string;
  host: string;
  origin: string;
};

/**
 * Replaces each Liquid output `{{ ... }}` and tag `{% ... %}` with the placeholder, the two things
 * a hooks URL renders per run. Left to right, each opener takes the first closer after it. One
 * scan: a `/\{\{[\s\S]*?\}\}/` regex retries from every unclosed opener, quadratic on long input.
 */
function renderTemplates(hooksUrl: string, placeholder: string): string {
  let out = "";
  let i = 0;
  let outputUnclosed = false;
  let tagUnclosed = false;
  while (i < hooksUrl.length) {
    let close = -1;
    if (!outputUnclosed && hooksUrl.startsWith("{{", i)) {
      close = hooksUrl.indexOf("}}", i + 2);
      if (close < 0) outputUnclosed = true;
    } else if (!tagUnclosed && hooksUrl.startsWith("{%", i)) {
      close = hooksUrl.indexOf("%}", i + 2);
      if (close < 0) tagUnclosed = true;
    }
    if (close < 0) {
      out += hooksUrl[i];
      i += 1;
    } else {
      out += placeholder;
      i = close + 2;
    }
  }
  return out;
}

/** A brace, raw or percent-encoded: a template, or what renders into one. */
const BRACE = /[{}]|%7B|%7D/i;

/**
 * The scheme and authority as the WHATWG URL parser reads them for http(s): any run of `/` and `\`
 * after the scheme opens the authority, and it ends at the next `/`, `\`, `?` or `#`. Without a
 * scheme, everything before the first of those.
 */
const SCHEME_AND_AUTHORITY = /^(?:[a-z][a-z0-9+.-]*:)?[/\\]*[^/\\?#]*/i;

/**
 * The value the URL parser reads: C0 controls and spaces trimmed, tabs and newlines removed. The
 * trim is an index scan, not a regex: a `[\u0000- ]+$` pattern backtracks quadratically on a long
 * control run.
 */
function asParsed(hooksUrl: string): string {
  let start = 0;
  let end = hooksUrl.length;
  while (start < end && hooksUrl.charCodeAt(start) <= 0x20) start += 1;
  while (end > start && hooksUrl.charCodeAt(end - 1) <= 0x20) end -= 1;
  return hooksUrl.slice(start, end).replace(/[\t\n\r]/g, "");
}

/** Where a URL sends a call once its templates render as a placeholder, if it parses. */
type Destination = { parses: true; key: string; origin: string } | { parses: false };

function destination(hooksUrl: string, placeholder: string): Destination {
  try {
    const url = new URL(renderTemplates(hooksUrl, placeholder));
    // Scheme, user, password and host: what a template must not choose.
    return {
      parses: true,
      key: `${url.protocol}//${url.username}:${url.password}@${url.host}`,
      origin: url.origin,
    };
  } catch {
    return { parses: false };
  }
}

/** Whether rendering the templates differently sends the call somewhere else. */
function templatesMoveDestination(hooksUrl: string): boolean {
  const [x, y] = [destination(hooksUrl, "x"), destination(hooksUrl, "y")];

  return x.parses ? !y.parses || x.key !== y.key : y.parses;
}

/**
 * Whether a template (or an encoded brace) is in a hooks URL's scheme or authority, or moves where
 * it parses to: run parameters could then send a hook, with the agent's credentials, to any host.
 * A template in the path, query or fragment cannot. Spec: scenario-run-hooks.feature.
 */
export function templatesHooksOrigin(hooksUrl: string | undefined): boolean {
  const parsed = asParsed(hooksUrl ?? "");
  const schemeAndAuthority = SCHEME_AND_AUTHORITY.exec(parsed)?.[0] ?? "";

  return BRACE.test(schemeAndAuthority) || templatesMoveDestination(parsed);
}

/** A hooks URL's origin whatever its templates render to, unless a template can choose it. */
export type HooksOriginRead = { isFixed: true; origin: string } | { isFixed: false };

/**
 * The origin a hooks URL sends to, not fixed when a template can choose its scheme, user or host
 * or it does not parse. Run time holds a hook call to it, for a URL saved before the save refused.
 */
export function readHooksOrigin(hooksUrl: string): HooksOriginRead {
  const parsed = asParsed(hooksUrl);
  const read = destination(parsed, "x");
  if (!read.parses || templatesMoveDestination(parsed)) return { isFixed: false };

  return { isFixed: true, origin: read.origin };
}
