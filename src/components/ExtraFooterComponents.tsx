import { useEffect } from "react";
import { useOrganizationTeamProject } from "../../langwatch/langwatch/src/hooks/useOrganizationTeamProject";
import { useRequiredSession } from "../../langwatch/langwatch/src/hooks/useRequiredSession";
import Script from "next/script";
import { api } from "../../langwatch/langwatch/src/utils/api";

export function ExtraFooterComponents() {
  const session = useRequiredSession({
    required: false,
  });

  return (
    <>
      <Script
        async
        src="https://www.googletagmanager.com/gtag/js?id=G-0VEKZY9DMY"
      ></Script>
      <Script id="google-analytics">
        {`
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', 'G-0VEKZY9DMY');
    `}
      </Script>
      <Script id="crisp">
        {`window.$crisp=[];window.CRISP_WEBSITE_ID="cca9eacd-c4d6-4258-a7fc-9606be6fd012";(function(){d=document;s=d.createElement("script");s.src="https://client.crisp.chat/l.js";s.async=1;d.getElementsByTagName("head")[0].appendChild(s);})();`}
      </Script>
      {session.data?.user ? <SignedInExtraFooterComponents /> : null}
    </>
  );
}

export function SignedInExtraFooterComponents() {
  const user = api.user.updateLastLogin.useMutation();

  const session = useRequiredSession();
  const { organization, project } = useOrganizationTeamProject({
    redirectToOnboarding: false,
  });

  useEffect(() => {
    const gtag = (window as any).gtag;
    if (!session.data?.user || !organization || !project || !gtag) return;

    void user.mutate({
      userId: session.data.user.id,
    });

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

  return null;
}
