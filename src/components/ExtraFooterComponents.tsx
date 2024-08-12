import { useEffect } from "react";
import { useOrganizationTeamProject } from "../../langwatch/langwatch/src/hooks/useOrganizationTeamProject";
import { useRequiredSession } from "../../langwatch/langwatch/src/hooks/useRequiredSession";
import Script from "next/script";
import { api } from "../../langwatch/langwatch/src/utils/api";
import { useRouter } from "next/router";

export function ExtraFooterComponents() {
  const session = useRequiredSession({
    required: false,
  });

  const router = useRouter();
  const currentUrl = router.asPath;
  const isAdmin = currentUrl.includes("/admin");

  const { organization, project } = useOrganizationTeamProject({
    redirectToOnboarding: !isAdmin,
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
      <Script id="pendo">
        {`(function(apiKey){
    (function(p,e,n,d,o){var v,w,x,y,z;o=p[d]=p[d]||{};o._q=o._q||[];
    v=['initialize','identify','updateOptions','pageLoad','track'];for(w=0,x=v.length;w<x;++w)(function(m){
        o[m]=o[m]||function(){o._q[m===v[0]?'unshift':'push']([m].concat([].slice.call(arguments,0)));};})(v[w]);
        y=e.createElement(n);y.async=!0;y.src='https://cdn.eu.pendo.io/agent/static/'+apiKey+'/pendo.js';
        z=e.getElementsByTagName(n)[0];z.parentNode.insertBefore(y,z);})(window,document,'script','pendo');

    pendo.initialize({
        visitor: {
            id: ${session.data?.user?.id},
            email: ${session.data?.user?.email},
            name: ${session.data?.user?.name},
        },
        account: {
            id: ${organization?.id},
            projectName: ${project?.name},
            organizationName: ${organization?.name},
        }
    });
})('18f008fe-1a55-4b22-70d9-964d6e98b130');`}
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

    if (!(session.data.user as any).impersonator) {
      void user.mutate({
        userId: session.data.user.id,
      });
    }

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
