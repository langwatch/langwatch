import { useEffect, useRef } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useRequiredSession } from "~/hooks/useRequiredSession";
import Script from "next/script";

import { api } from "~/utils/api";
import posthog from "posthog-js";

export function ExtraFooterComponents() {
  const session = useRequiredSession({ required: false });

  return (
    <>
      <Script id="gtm-init" strategy="afterInteractive">
        {`
          (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
          new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
          j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;
          j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;
          f.parentNode.insertBefore(j,f);
          })(window,document,'script','dataLayer','GTM-KJ4S6Z9C');
        `}
      </Script>
      {session.data?.user ? <SignedInExtraFooterComponents /> : null}
    </>
  );
}

export function SignedInExtraFooterComponents() {
  const updateLastLogin = api.user.updateLastLogin.useMutation();

  const session = useRequiredSession();
  const { organization, project } = useOrganizationTeamProject({
    redirectToOnboarding: false,
  });

  const hasTracked = useRef(false);

  useEffect(() => {
    if (!session.data?.user?.email || !organization?.name || hasTracked.current)
      return;

    (window as any).Reo?.identify?.({
      username: session.data.user.email,
      type: "email",
      firstname: session.data.user.name || "",
      company: organization.name,
    });
    hasTracked.current = true;
  }, [session.data?.user?.email, session.data?.user?.name, organization?.name]);

  useEffect(() => {
    const gtag = (window as any).gtag;
    if (!session.data?.user || !organization || !project || !gtag) return;

    if (!(session.data.user as any).impersonator) {
      void updateLastLogin.mutate({});
    }

    if (!(session.data.user as any).impersonator) {
      gtag("set", "user_properties", {
        organization_id: organization.id,
        organization_name: organization.name,
        project_id: project.id,
        project_name: project.name,
        environment: process.env.NODE_ENV,
        user_id: session.data.user.id,
      });

      gtag("event", "open_dashboard", {
        organization_id: organization.id,
        organization_name: organization.name,
        project_id: project.id,
        project_name: project.name,
        environment: process.env.NODE_ENV,
        user_id: session.data.user.id,
      });
    }
  }, [organization?.id, project?.id]);

  useEffect(() => {
    if (session.data?.user && !(session.data.user as any).impersonator) {
      posthog.identify(session.data.user.id, {
        email: session.data.user.email,
        name: session.data.user.name,
        organization_id: organization?.id,
        organization_name: organization?.name,
        project_id: project?.id,
        project_name: project?.name,
      });
    }
  }, [session.data?.user, organization?.id, project?.id]);

  if (!session.data || !organization || !project) {
    return null;
  }

  return (
    <>
      {(session.data?.user as any)?.impersonator ? null : (
        <>
          <Script id="pendo">
            {`(function(apiKey){
    (function(p,e,n,d,o){var v,w,x,y,z;o=p[d]=p[d]||{};o._q=o._q||[];
    v=['initialize','identify','updateOptions','pageLoad','track'];for(w=0,x=v.length;w<x;++w)(function(m){
        o[m]=o[m]||function(){o._q[m===v[0]?'unshift':'push']([m].concat([].slice.call(arguments,0)));};})(v[w]);
        y=e.createElement(n);y.async=!0;y.src='https://cdn.eu.pendo.io/agent/static/'+apiKey+'/pendo.js';
        z=e.getElementsByTagName(n)[0];z.parentNode.insertBefore(y,z);})(window,document,'script','pendo');

    pendo.initialize({
        visitor: {
            id: "${session.data.user?.id || ""}",
            email: "${session.data.user?.email || ""}",
            name: "${session.data.user?.name || ""}"
        },
        account: {
            id: "${organization.id || ""}",
            projectName: "${project.name || ""}",
            organizationName: "${organization.name || ""}"
        }
    });
})('18f008fe-1a55-4b22-70d9-964d6e98b130');`}
          </Script>
          {window.location.pathname.includes("/studio") ? null : (
            <Script id="crisp">
              {`window.$crisp=[];window.$crisp.push(["do", "chat:hide"]);window.$crisp.push(["on", "chat:closed", () => { window.$crisp.push(["do", "chat:hide"]); }]);window.CRISP_WEBSITE_ID="cca9eacd-c4d6-4258-a7fc-9606be6fd012";(function(){d=document;s=d.createElement("script");s.src="https://client.crisp.chat/l.js";s.async=1;d.getElementsByTagName("head")[0].appendChild(s);})();`}
            </Script>
          )}
        </>
      )}
    </>
  );
}
