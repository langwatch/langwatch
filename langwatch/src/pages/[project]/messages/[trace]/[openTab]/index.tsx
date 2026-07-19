import { useRouter } from "~/utils/compat/next-router";
import { useEffect } from "react";

/**
 * Redirect page for the legacy /[project]/messages/[trace]/[openTab] deep
 * link. Old links land here; they now open the Trace Explorer drawer, which
 * is the default trace experience. The legacy tab has no Trace Explorer
 * equivalent, so it is dropped.
 */
export default function TraceDetailsWithTabRedirect() {
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
