import { useEffect } from "react";
import { useRouter } from "~/utils/compat/next-router";

/** Schedules live on the event-sourcing page now; old links follow. */
export default function OpsSchedulerPage() {
  const router = useRouter();
  useEffect(() => {
    void router.replace("/ops/event-sourcing");
  }, [router]);
  return null;
}
