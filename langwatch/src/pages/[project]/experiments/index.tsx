import { useRouter } from "next/router";
import { useEffect } from "react";
import { LoadingScreen } from "~/components/LoadingScreen";

export default function ExperimentsRedirect() {
  const router = useRouter();
  const { project } = router.query;

  useEffect(() => {
    if (project && typeof project === "string" && /^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(project)) {
      void router.replace(`/${project}/evaluations`);
    }
  }, [project, router]);

  return <LoadingScreen />;
}
