import { useEffect } from "react";
import { useRouter } from "~/utils/compat/next-router";

/**
 * Redirect page for the legacy /[project]/messages index. The legacy Traces
 * page is gone; Trace Explorer is the traces experience. Bookmarks, saved
 * links and older notification emails land here.
 *
 * Everything the link carried apart from the project slug is forwarded, so a
 * link saved with a filter or a date range arrives filtered rather than on a
 * bare list. Parameters the Trace Explorer does not know (the legacy
 * `view=table|list` toggle, for one) are inert rather than harmful.
 */
export default function LegacyTracesRedirect() {
  const router = useRouter();
  const projectSlug = router.query.project as string | undefined;

  useEffect(() => {
    if (!router.isReady) return;
    // A ready router with no slug means a malformed or stale link; send it to
    // 404 rather than leaving a permanently blank page.
    if (!projectSlug) {
      void router.replace("/404");
      return;
    }

    const { project: _project, ...carried } = router.query;

    void router.replace({
      pathname: `/${projectSlug}/traces`,
      query: carried,
    });
  }, [projectSlug, router, router.isReady]);

  return null;
}
