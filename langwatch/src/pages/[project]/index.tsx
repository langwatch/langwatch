import { useRouter } from "next/router";
import { useEffect } from "react";
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
 */
function HomePageWithReturnTo() {
  const router = useRouter();
  const returnTo = router.query.return_to;
  const safeReturnToPath = getSafeReturnToPath(returnTo);
  const shouldRedirect = Boolean(
    safeReturnToPath && typeof window !== "undefined",
  );

  useEffect(() => {
    if (shouldRedirect && safeReturnToPath) {
      void router.push(safeReturnToPath);
    }
  }, [router, safeReturnToPath, shouldRedirect]);

  // Don't render anything while redirecting
  if (shouldRedirect) {
    return null;
  }

  return <HomePage />;
}

export default ProjectRouter;
