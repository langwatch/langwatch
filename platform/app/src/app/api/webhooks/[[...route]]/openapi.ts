/**
 * Spec options for the RPC-named webhooks family (ADR-094).
 *
 * `excludeStaticFile` defaults to TRUE in hono-openapi, and its filter reads:
 *
 * ```js
 * !excludeStaticFile || !path.includes(".") || path.includes("{")
 * ```
 *
 * A dotted path with no `{param}` is therefore taken for a static asset —
 * `/favicon.ico`, `/robots.txt` — and dropped from the document. Every RPC
 * name is dotted and parameterless by construction, so on the default the
 * whole family generates ZERO paths: `generateSpecs` returns `{}`, the task
 * exits 0, and the merge quietly publishes nothing. Nothing throws, and the
 * only visible symptom is a reference that has lost every webhooks page.
 *
 * Scoped to this family because `generateSpecs` is called per app: no other
 * family relaxes the guard, and none of them wants to — they are all
 * resource-REST with no dots to protect.
 */
import type { OpenApiSpecsOptions } from "hono-openapi";

export const WEBHOOKS_SPEC_OPTIONS: OpenApiSpecsOptions = {
  excludeStaticFile: false,
};
