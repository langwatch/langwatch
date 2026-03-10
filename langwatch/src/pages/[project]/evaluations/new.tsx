import { useRouter } from "next/router";
import { useEffect } from "react";

/**
 * Redirect page for /[project]/evaluations/new
 * Opens the evaluatorCategorySelector drawer on the evaluations page.
 */
export default function NewEvaluationRedirect() {
  const router = useRouter();
  const projectSlug = router.query.project as string | undefined;

  useEffect(() => {
    if (!projectSlug || !router.isReady) return;

    void router.replace(
      `/${projectSlug}/evaluations?drawer.open=evaluatorCategorySelector`,
    );
  }, [projectSlug, router, router.isReady]);

  return null;
}
