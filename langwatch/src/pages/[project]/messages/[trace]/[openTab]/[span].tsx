import { useRouter } from "~/utils/compat/next-router";
import { useEffect } from "react";

/**
 * Redirect page for the legacy /[project]/messages/[trace]/[openTab]/[span]
 * deep link. Old links land here; they now open the Trace Explorer drawer
 * with the span selected. The legacy tab has no Trace Explorer equivalent,
 * so it is dropped.
 */
export default function TraceDetailsWithSpanRedirect() {
  const router = useRouter();
  const projectSlug = router.query.project as string | undefined;
  const traceId = router.query.trace as string | undefined;
  const span = router.query.span as string | undefined;

  useEffect(() => {
    if (!router.isReady) return;
    // A ready router with no slug/trace means a malformed or stale link;
    // send it to 404 rather than leaving a permanently blank page.
    if (!projectSlug || !traceId) {
      void router.replace("/404");
      return;
    }

    const spanParam = span ? `&drawer.span=${encodeURIComponent(span)}` : "";
    void router.replace(
      `/${projectSlug}/traces?drawer.open=traceV2Details&drawer.traceId=${encodeURIComponent(traceId)}${spanParam}`,
    );
  }, [projectSlug, traceId, span, router, router.isReady]);

  return null;
}
