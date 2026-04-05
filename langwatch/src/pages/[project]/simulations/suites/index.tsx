/**
 * Redirect: old suites URLs → new unified simulations page.
 *
 * /simulations/suites?suite=X       → /simulations/run-plans/X
 * /simulations/suites?externalSet=Y → /simulations/Y
 * /simulations/suites               → /simulations
 */
import { useRouter } from "next/router";
import { useEffect } from "react";

export default function SuitesRedirect() {
  const router = useRouter();

  useEffect(() => {
    if (!router.isReady) return;

    const { project, suite, externalSet } = router.query;
    if (!project) return;

    const projectSlug = String(project);

    if (typeof suite === "string" && suite) {
      void router.replace(`/${projectSlug}/simulations/run-plans/${suite}`);
    } else if (typeof externalSet === "string" && externalSet) {
      void router.replace(`/${projectSlug}/simulations/${externalSet}`);
    } else {
      void router.replace(`/${projectSlug}/simulations`);
    }
  }, [router.isReady, router.query, router]);

  return null;
}
