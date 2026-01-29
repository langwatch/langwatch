import { useRouter } from "next/router";
import { useEffect } from "react";

/**
 * Redirect page for /[project]/messages/[trace]
 * Opens the traceDetails drawer on the messages page.
 */
export default function TraceDetailsRedirect() {
  const router = useRouter();
  const projectSlug = router.query.project as string | undefined;
  const traceId = router.query.trace as string | undefined;

  useEffect(() => {
    if (!projectSlug || !traceId || !router.isReady) return;

    void router.replace(
      `/${projectSlug}/messages?drawer.open=traceDetails&drawer.traceId=${encodeURIComponent(traceId)}`
    );
  }, [projectSlug, traceId, router, router.isReady]);

  return null;
}
