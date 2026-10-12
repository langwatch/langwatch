import { useEffect } from "react";
import {
  projectEntryPath,
  projectNavigation,
} from "~/components/sidebar/projectKindNavigation";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useRouter } from "~/utils/compat/next-router";
import { getSafeReturnToPath } from "~/utils/getSafeReturnToPath";
import { HomePage } from "../../components/home/HomePage";

function ProjectRouter() {
  return <HomePageWithReturnTo />;
}

/**
 * HomePageWithReturnTo
 * Wraps HomePage to handle return_to query parameter redirects.
 * This preserves the existing behavior where users can be redirected
 * after authentication or other flows.
 *
 * A project whose navigation offers no home (an aggregate, ADR-144) is sent
 * on to where it lands instead, its Trace Explorer. The redirect replaces the
 * home in the history, so Back leaves the project rather than bouncing off a
 * page that only redirects. A return_to still wins: it names where the reader
 * was going.
 */
function HomePageWithReturnTo() {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  const returnTo = router.query.return_to;
  const safeReturnToPath = getSafeReturnToPath(returnTo);
  const shouldRedirect = Boolean(
    safeReturnToPath && typeof window !== "undefined",
  );
  const entryPath =
    project && !projectNavigation(project.kind).home
      ? projectEntryPath(project)
      : null;

  useEffect(() => {
    if (shouldRedirect && safeReturnToPath) {
      void router.push(safeReturnToPath);
      return;
    }
    if (entryPath) {
      void router.replace(entryPath);
    }
  }, [router, safeReturnToPath, shouldRedirect, entryPath]);

  // Don't render anything while redirecting
  if (shouldRedirect || entryPath) {
    return null;
  }

  return <HomePage />;
}

export default ProjectRouter;
