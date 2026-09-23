import type {
  SaasBrowserScope,
  SaasBrowserService,
  SaasBrowserUser,
} from "@langwatch/enterprise-saas-contract";
import { useEffect, useRef, type ComponentType, type ReactNode } from "react";

import type { SaasBrowserAnalytics } from "./saas-browser-analytics.ts";

export type ScriptComponent = ComponentType<{
  id: string;
  strategy?: "afterInteractive" | "beforeInteractive" | "lazyOnload" | "worker";
  children?: ReactNode;
}>;

export type ExtraFooterComponentsProps = {
  isSaas: boolean;
  user?: SaasBrowserUser;
  organization?: SaasBrowserScope;
  project?: SaasBrowserScope;
  environment: string;
  pathname: string;
  runtime: SaasBrowserService;
  analytics: SaasBrowserAnalytics;
  Script: ScriptComponent;
  configureCrispBubble: (enabled: boolean) => void;
};

export function ExtraFooterComponents(props: ExtraFooterComponentsProps) {
  const { configureCrispBubble, isSaas } = props;
  useEffect(() => {
    configureCrispBubble(isSaas);
  }, [configureCrispBubble, isSaas]);

  if (!props.isSaas) return null;

  return (
    <>
      <props.Script id="gtm-init" strategy="afterInteractive">
        {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;
j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;
f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','GTM-KJ4S6Z9C');`}
      </props.Script>
      {props.user ? <SignedInExtraFooterComponents {...props} user={props.user} /> : null}
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

export function SignedInExtraFooterComponents(
  props: ExtraFooterComponentsProps & { user: SaasBrowserUser },
) {
  const { analytics, environment, organization, project, runtime, user } = props;
  const hasTracked = useRef(false);
  const hasUpdatedLastLogin = useRef(false);

  useEffect(() => {
    if (!user.email || !organization?.name || hasTracked.current) return;
    return analytics.identifyReo({
      user,
      organization,
      onIdentified: () => {
        hasTracked.current = true;
      },
    });
  }, [analytics, user, organization]);

  useEffect(() => {
    if (!organization || !project || hasUpdatedLastLogin.current || user.impersonator) return;
    hasUpdatedLastLogin.current = true;
    runtime.updateLastLogin();
  }, [organization, project, runtime, user.impersonator]);

  useEffect(() => {
    if (!organization || !project || user.impersonator) return;
    return analytics.trackDashboardOpen({ user, organization, project, environment });
  }, [analytics, environment, organization, project, user]);

  useEffect(() => {
    if (!user.impersonator) {
      analytics.identifyPostHogUser({ user, organization, project });
    }
  }, [analytics, organization, project, user]);

  if (!props.organization || !props.project) return null;

  return (
    <>
      {props.user.impersonator ? null : (
        <>
          <props.Script id="pendo">
            {`(function(apiKey){
(function(p,e,n,d,o){var v,w,x,y,z;o=p[d]=p[d]||{};o._q=o._q||[];
v=['initialize','identify','updateOptions','pageLoad','track'];for(w=0,x=v.length;w<x;++w)(function(m){
o[m]=o[m]||function(){o._q[m===v[0]?'unshift':'push']([m].concat([].slice.call(arguments,0)));};})(v[w]);
y=e.createElement(n);y.async=!0;y.src='https://cdn.eu.pendo.io/agent/static/'+apiKey+'/pendo.js';
z=e.getElementsByTagName(n)[0];z.parentNode.insertBefore(y,z);})(window,document,'script','pendo');
pendo.initialize({visitor:{id:'${sanitizeForJs(props.user.id)}',email:'${sanitizeForJs(props.user.email ?? "")}',name:'${sanitizeForJs(props.user.name ?? "")}'},account:{id:'${sanitizeForJs(props.organization.id)}',projectName:'${sanitizeForJs(props.project.name)}',organizationName:'${sanitizeForJs(props.organization.name)}'}});
})('18f008fe-1a55-4b22-70d9-964d6e98b130');`}
          </props.Script>
          {props.pathname.includes("/studio") ? null : (
            <props.Script id="crisp">
              {`window.$crisp=window.$crisp||[];window.CRISP_WEBSITE_ID="cca9eacd-c4d6-4258-a7fc-9606be6fd012";(function(){d=document;s=d.createElement("script");s.src="https://client.crisp.chat/l.js";s.async=1;d.getElementsByTagName("head")[0].appendChild(s);})();`}
            </props.Script>
          )}
        </>
      )}
    </>
  );
}
