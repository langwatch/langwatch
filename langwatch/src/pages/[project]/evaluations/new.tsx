import { useEffect } from "react";
import { useRouter } from "~/utils/compat/next-router";

/**
 * Redirect page for /[project]/evaluations/new
 * Opens the evaluator category selector from the online evaluations page.
 */
export default function NewEvaluationRedirect() {
  const router = useRouter();
  const projectSlug = router.query.project as string | undefined;

  useEffect(() => {
    if (!projectSlug || !router.isReady) return;

    void router.replace(
      `/${projectSlug}/online-evaluations?drawer.open=evaluatorCategorySelector`,
    );
  }, [projectSlug, router, router.isReady]);

  return null;
}
