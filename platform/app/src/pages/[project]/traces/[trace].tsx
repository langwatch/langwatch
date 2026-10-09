import { useEffect } from "react";
import { useRouter } from "~/utils/compat/next-router";

/**
 * Redirect page for /[project]/traces/[trace] — the canonical short link to a
 * single trace, used by notification links (Slack, email, webhooks) and API
 * responses. Opens the Trace Explorer drawer for that trace.
 */
export default function TraceDeepLinkRedirect() {
  const router = useRouter();
  const projectSlug = router.query.project as string | undefined;
  const traceId = router.query.trace as string | undefined;
  // The trace's start time, when the link carries it: the drawer reads it as
  // the partition hint, so the trace opens in one pruned read instead of a
  // scan by id across every partition.
  const hint = router.query.t;
  const occurredAt =
    typeof hint === "string" && /^[1-9]\d*$/.test(hint) ? hint : null;

  useEffect(() => {
    if (!router.isReady) return;
    // A ready router with no slug/trace means a malformed or stale link;
    // send it to 404 rather than leaving a permanently blank page.
    if (!projectSlug || !traceId) {
      void router.replace("/404");
      return;
    }

    void router.replace(
      `/${projectSlug}/traces?drawer.open=traceV2Details&drawer.traceId=${encodeURIComponent(traceId)}${
        occurredAt ? `&drawer.t=${occurredAt}` : ""
      }`,
    );
  }, [projectSlug, traceId, occurredAt, router, router.isReady]);

  return null;
}
