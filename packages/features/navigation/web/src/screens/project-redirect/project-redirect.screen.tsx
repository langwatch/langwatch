/**
 * `/@project/<rest>`: the address that means "this page, in whichever project I
 * am in".
 *
 * Moved from `platform/app/src/pages/@project/[...path]/index.tsx`. It exists
 * so a link can be written without knowing the reader's project — the
 * onboarding mails and the docs use it — and its whole body is one redirect.
 *
 * THE FIVE-SECOND FALLBACK IS THE POINT. A reader whose workspace never
 * resolves has no project to substitute, and an address that spins forever
 * teaches nothing; sending them to `/` puts them where the landing redirect can
 * decide. The timer is cleared the moment the project does arrive.
 *
 * The remaining path comes off the host rather than a router: `catchAll` is the
 * segments after `@project`, already joined, which is the one thing the address
 * carries that the port does not otherwise answer.
 */

import { useEffect } from "react";
import { useNavigationHost } from "../../model/navigation-host";

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
