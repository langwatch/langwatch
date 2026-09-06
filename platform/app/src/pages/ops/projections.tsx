import { useEffect } from "react";
import { useRouter } from "~/utils/compat/next-router";

/**
 * Projection replay is a drawer on the event-sourcing page now; old links
 * follow. Per-run progress keeps its page at /ops/projections/:runId.
 */
export default function OpsProjectionsPage() {
  const router = useRouter();
  useEffect(() => {
    void router.replace(
      "/ops/event-sourcing/projections?drawer.open=opsReplay",
    );
  }, [router]);
  return null;
}
