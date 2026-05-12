import { useEffect, useRef } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useRequiredSession } from "~/hooks/useRequiredSession";
import Script from "~/utils/compat/next-script";

import { usePublicEnv } from "~/hooks/usePublicEnv";
import { api } from "~/utils/api";
import posthog from "posthog-js";

export function ExtraFooterComponents() {
  const session = useRequiredSession({ required: false });
  const publicEnv = usePublicEnv();

  if (!publicEnv.data?.IS_SAAS) {
    return null;
  }

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

function sanitizeForJs(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/</g, "\\x3c")
    .replace(/>/g, "\\x3e");
}

export function SignedInExtraFooterComponents() {
  const updateLastLogin = api.user.updateLastLogin.useMutation();

  const session = useRequiredSession();
  const { organization, project } = useOrganizationTeamProject({
    redirectToOnboarding: false,
  });

  const hasTracked = useRef(false);
  const hasUpdatedLastLogin = useRef(false);

  useEffect(() => {
    if (!session.data?.user?.email || !organization?.name || hasTracked.current)
      return;

    const reo = (window as any).Reo;
    if (!reo?.identify) return;

    reo.identify({
      username: session.data.user.email,
      type: "email",
      firstname: session.data.user.name || "",
      company: organization.name,
    });
    hasTracked.current = true;
  }, [session.data?.user?.email, session.data?.user?.name, organization?.name]);

  // Update last login separately from analytics — don't gate on gtag availability
  useEffect(() => {
    if (
      !session.data?.user ||
      !organization ||
      !project ||
      hasUpdatedLastLogin.current
    )
      return;
    if (session.data.user.impersonator) return;

    hasUpdatedLastLogin.current = true;
    void updateLastLogin.mutate({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organization?.id, project?.id]);

  useEffect(() => {
    const gtag = (window as any).gtag;
    if (!session.data?.user || !organization || !project || !gtag) return;

    if (!session.data.user.impersonator) {
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
    if (session.data?.user && !session.data.user.impersonator) {
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

  const isImpersonating = !!session.data?.user?.impersonator;
  const isInStudio =
    typeof window !== "undefined" &&
    window.location.pathname.includes("/studio");

  return (
    <>
      {isImpersonating ? null : (
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
            id: '${sanitizeForJs(session.data.user?.id || "")}',
            email: '${sanitizeForJs(session.data.user?.email || "")}',
            name: '${sanitizeForJs(session.data.user?.name || "")}'
        },
        account: {
            id: '${sanitizeForJs(organization.id || "")}',
            projectName: '${sanitizeForJs(project.name || "")}',
            organizationName: '${sanitizeForJs(organization.name || "")}'
        }
    });
})('18f008fe-1a55-4b22-70d9-964d6e98b130');`}
          </Script>
          {isInStudio ? null : (
            <Script id="crisp">
              {`window.$crisp=[];window.$crisp.push(["do", "chat:hide"]);window.$crisp.push(["on", "chat:closed", () => { window.$crisp.push(["do", "chat:hide"]); }]);window.CRISP_WEBSITE_ID="cca9eacd-c4d6-4258-a7fc-9606be6fd012";(function(){d=document;s=d.createElement("script");s.src="https://client.crisp.chat/l.js";s.async=1;d.getElementsByTagName("head")[0].appendChild(s);})();`}
            </Script>
          )}
        </>
      )}
    </>
  );
}
