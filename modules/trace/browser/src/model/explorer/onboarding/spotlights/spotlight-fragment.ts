/**
 * The tour step in the URL fragment. It rides as an `sp=` parameter beside the
 * lens/query fragment useURLSync owns (`#all-traces?q=…&sp=<id>`), or alone as
 * `#sp=<id>`; each side rewrites only its own part.
 */
const SP_PREFIX = "sp=";

/** The fragment body split into the explorer state and the still-encoded tour step. */
export function splitTourStep(hash: string): { rest: string; step: string | null } {
  const body = hash.replace(/^#/, "");
  if (body.startsWith(SP_PREFIX)) {
    return { rest: "", step: body.slice(SP_PREFIX.length) };
  }
  const separator = body.indexOf("?");
  if (separator === -1) return { rest: body, step: null };
  const params = body.slice(separator + 1).split("&");
  const stepParam = params.find((param) => param.startsWith(SP_PREFIX));
  const kept = params.filter((param) => param && !param.startsWith(SP_PREFIX));
  const base = body.slice(0, separator);
  return {
    rest: kept.length > 0 ? `${base}?${kept.join("&")}` : base,
    step: stepParam === undefined ? null : stepParam.slice(SP_PREFIX.length),
  };
}

/** A fragment body (no `#`) with the already-encoded tour step added to it. */
export function withTourStep({ rest, step }: { rest: string; step: string }): string {
  const param = `${SP_PREFIX}${step}`;
  if (!rest) return param;
  return rest.includes("?") ? `${rest}&${param}` : `${rest}?${param}`;
}
