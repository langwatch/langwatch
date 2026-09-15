/**
 * Redirect /@project/<rest> to current project. 5s fallback to /. Moved from platform/app.
 * Allows links without project context (mails, docs). Path from host (no router access).
 */

import { useEffect } from "react";
import { useNavigationHost } from "../../../model/navigation-host.ts";

/** How long a reader waits for a project before they are sent to the root. */
const RESOLUTION_GRACE_MS = 5_000;

export default function ProjectRedirectScreen() {
  const host = useNavigationHost();
  const project = host.project();
  const rest = host.catchAllPath();

  const slug = project?.slug;
  useEffect(() => {
    const timeout = setTimeout(() => host.replace("/"), RESOLUTION_GRACE_MS);
    if (slug) {
      clearTimeout(timeout);
      host.replace(`/${slug}/${rest}`);
    }
    return () => clearTimeout(timeout);
  }, [host, slug, rest]);

  return <>{host.waiting()}</>;
}
