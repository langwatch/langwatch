/**
 * Where a failure nobody is waiting on goes.
 *
 * `platform/app`'s `captureException` sends to PostHog through a client this
 * application configures at boot, which a feature-web package may not reach.
 * The two call sites here are `.catch()` handlers on cache invalidations after
 * a member was removed or disabled: the write already succeeded and the reader
 * already has their confirmation, so this is a diagnostic and never a notice.
 *
 * RECORDED AS A LOSS, not a substitution: these no longer reach product
 * analytics. They will again when the error-reporting capability joins the
 * feedback one on `apps/ui`'s capability layer — the same slice that owes the
 * presentation-registry harvest.
 */

export function reportUnexpected(error: unknown, tags: Record<string, string>): void {
  console.error("[organization-web]", tags, error);
}
