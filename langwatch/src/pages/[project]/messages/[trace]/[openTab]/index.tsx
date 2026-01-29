import { useRouter } from "next/router";
import { useEffect } from "react";

/**
 * Redirect page for /[project]/messages/[trace]/[openTab]
 * Opens the traceDetails drawer on the messages page with the specified tab.
 */
export default function TraceDetailsWithTabRedirect() {
  const router = useRouter();
  const projectSlug = router.query.project as string | undefined;
  const traceId = router.query.trace as string | undefined;
  const openTab = router.query.openTab as string | undefined;

  useEffect(() => {
    if (!projectSlug || !traceId || !router.isReady) return;

    const tabParam = openTab ? `&drawer.openTab=${encodeURIComponent(openTab)}` : "";
    void router.replace(
      `/${projectSlug}/messages?drawer.open=traceDetails&drawer.traceId=${encodeURIComponent(traceId)}${tabParam}`
    );
  }, [projectSlug, traceId, openTab, router, router.isReady]);

  return null;
}
