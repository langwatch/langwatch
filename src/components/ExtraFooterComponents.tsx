import { useEffect } from "react";
import { useOrganizationTeamProject } from "../../langwatch/langwatch/src/hooks/useOrganizationTeamProject";
import { useRequiredSession } from "../../langwatch/langwatch/src/hooks/useRequiredSession";

export function ExtraFooterComponents() {
  const session = useRequiredSession();
  const { organization, project } = useOrganizationTeamProject({
    redirectToOnboarding: false,
  });

  useEffect(() => {
    const gtag = (window as any).gtag;
    if (!session.data?.user || !organization || !project || !gtag) return;

    gtag("event", "open_dashboard", {
      organization_id: organization.id,
      organization_name: organization.name,
      project_id: project.id,
      project_name: project.name,
      environment: process.env.NODE_ENV,
      user_name: session.data.user.name,
      user_id: session.data.user.id,
    });
  }, [organization?.id, project?.id]);

  return <></>;
}
