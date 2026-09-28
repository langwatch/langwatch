/**
 * Copies a board's full address to the clipboard and says so. The clipboard is
 * absent on an insecure origin and refuses an unfocused page, so both land as a
 * failure notice rather than a silent no-op.
 */

import { useAnalyticsHost } from "../../../model/analytics-host.ts";
import { dashboardsPath } from "../model/boards.ts";

export function useCopyBoardLink({ dashboardId }: { dashboardId: string }) {
  const host = useAnalyticsHost();
  const projectSlug = host.project()?.slug ?? "";

  return () => {
    const failed = (error: unknown) =>
      host.failed({ error, fallbackTitle: "Couldn't copy the link" });
    const clipboard = globalThis.navigator?.clipboard;
    if (!clipboard) {
      failed(new Error("The clipboard is not available here"));
      return;
    }
    const link = new URL(
      dashboardsPath({ projectSlug, dashboardId }),
      globalThis.location.origin,
    ).toString();
    clipboard
      .writeText(link)
      .then(() => host.succeeded({ title: "Link copied" }))
      .catch(failed);
  };
}
