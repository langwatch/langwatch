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
    if (!projectSlug || !traceId || !router.isReady) return;

    const spanParam = span ? `&drawer.span=${encodeURIComponent(span)}` : "";
    void router.replace(
      `/${projectSlug}/traces?drawer.open=traceV2Details&drawer.traceId=${encodeURIComponent(traceId)}${spanParam}`,
    );
  }, [projectSlug, traceId, span, router, router.isReady]);

  return null;
}
