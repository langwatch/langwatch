import type {
  SaasBrowserScope,
  SaasBrowserService,
  SaasBrowserUser,
} from "@langwatch/enterprise-saas-contract";
import { useEffect, useRef, type ComponentType, type ReactNode } from "react";
import type { SaasBrowserAnalytics } from "./saas-browser-analytics";

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
  useEffect(() => {
    props.configureCrispBubble(props.isSaas);
  }, [props.configureCrispBubble, props.isSaas]);

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
  const hasTracked = useRef(false);
  const hasUpdatedLastLogin = useRef(false);

  useEffect(() => {
    if (!props.user.email || !props.organization?.name || hasTracked.current) return;
    return props.analytics.identifyReo({
      user: props.user,
      organization: props.organization,
      onIdentified: () => {
        hasTracked.current = true;
      },
    });
  }, [props.analytics, props.user.email, props.user.name, props.organization?.name]);

  useEffect(() => {
    if (
      !props.organization ||
      !props.project ||
      hasUpdatedLastLogin.current ||
      props.user.impersonator
    ) return;
    hasUpdatedLastLogin.current = true;
    props.runtime.updateLastLogin();
  }, [props.organization?.id, props.project?.id, props.runtime, props.user.impersonator]);

  useEffect(() => {
    if (!props.organization || !props.project || props.user.impersonator) return;
    return props.analytics.trackDashboardOpen({
      user: props.user,
      organization: props.organization,
      project: props.project,
      environment: props.environment,
    });
  }, [props.analytics, props.environment, props.organization?.id, props.project?.id, props.user]);

  useEffect(() => {
    if (!props.user.impersonator) {
      props.analytics.identifyPostHogUser({
        user: props.user,
        organization: props.organization,
        project: props.project,
      });
    }
  }, [props.analytics, props.organization?.id, props.project?.id, props.user]);

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
