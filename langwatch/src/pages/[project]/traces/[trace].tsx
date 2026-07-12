import { useRouter } from "~/utils/compat/next-router";
import { useEffect } from "react";

/**
 * Redirect page for /[project]/traces/[trace] — the canonical short link to a
 * single trace, used by notification links (Slack, email, webhooks) and API
 * responses. Opens the Trace Explorer drawer for that trace.
 */
export default function TraceDeepLinkRedirect() {
  const router = useRouter();
  const projectSlug = router.query.project as string | undefined;
  const traceId = router.query.trace as string | undefined;

  useEffect(() => {
    if (!router.isReady) return;
    // A ready router with no slug/trace means a malformed or stale link;
    // send it to 404 rather than leaving a permanently blank page.
    if (!projectSlug || !traceId) {
      void router.replace("/404");
      return;
    }

    void router.replace(
      `/${projectSlug}/traces?drawer.open=traceV2Details&drawer.traceId=${encodeURIComponent(traceId)}`,
    );
  }, [projectSlug, traceId, router, router.isReady]);

  return null;
}
