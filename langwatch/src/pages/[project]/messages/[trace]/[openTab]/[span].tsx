import { useRouter } from "next/router";
import { useEffect } from "react";

/**
 * Redirect page for /[project]/messages/[trace]/[openTab]/[span]
 * Opens the traceDetails drawer on the messages page with the specified tab and span.
 */
export default function TraceDetailsWithSpanRedirect() {
  const router = useRouter();
  const projectSlug = router.query.project as string | undefined;
  const traceId = router.query.trace as string | undefined;
  const openTab = router.query.openTab as string | undefined;
  const span = router.query.span as string | undefined;

  useEffect(() => {
    if (!projectSlug || !traceId || !router.isReady) return;

    const tabParam = openTab
      ? `&drawer.openTab=${encodeURIComponent(openTab)}`
      : "";
    const spanParam = span ? `&span=${encodeURIComponent(span)}` : "";
    void router.replace(
      `/${projectSlug}/messages?drawer.open=traceDetails&drawer.traceId=${encodeURIComponent(traceId)}${tabParam}${spanParam}`,
    );
  }, [projectSlug, traceId, openTab, span, router, router.isReady]);

  return null;
}
