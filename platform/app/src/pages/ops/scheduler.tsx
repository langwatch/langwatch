import { useEffect } from "react";
import { useRouter } from "~/utils/compat/next-router";

/** Schedules are a section of the event-sourcing workspace; old links follow. */
export default function OpsSchedulerPage() {
  const router = useRouter();
  useEffect(() => {
    void router.replace("/ops/event-sourcing/schedules");
  }, [router]);
  return null;
}
