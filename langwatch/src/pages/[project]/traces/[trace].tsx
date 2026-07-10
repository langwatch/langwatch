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
    if (!projectSlug || !traceId || !router.isReady) return;

    void router.replace(
      `/${projectSlug}/traces?drawer.open=traceV2Details&drawer.traceId=${encodeURIComponent(traceId)}`,
    );
  }, [projectSlug, traceId, router, router.isReady]);

  return null;
}
