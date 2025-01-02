import { useEffect } from "react";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";
import { useRouter } from "next/router";
import { LoadingScreen } from "../components/LoadingScreen";

export default function Index() {
  const { project, team } = useOrganizationTeamProject();
  const router = useRouter();

  if (router.query.utm_campaign && typeof window !== "undefined") {
    window.sessionStorage.setItem(
      "utm_campaign",
      router.query.utm_campaign as string
    );
  }

  useEffect(() => {
    if (project) {
      void router.replace(`/${project.slug}`);
    }
  }, [project, router, team]);

  return <LoadingScreen />;
}
