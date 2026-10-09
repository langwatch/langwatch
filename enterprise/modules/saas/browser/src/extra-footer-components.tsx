import type { SaasBrowserScope, SaasBrowserUser } from "@langwatch/enterprise-saas-contract";
import { useEffect, useRef } from "react";

import { useCrispBubblePolicy } from "./behavior/crisp-bubble-policy.ts";
import { SaasBrowserAnalytics } from "./saas-browser-analytics.ts";

export type ExtraFooterComponentsProps = {
  isSaas: boolean;
  user?: SaasBrowserUser;
  organization?: SaasBrowserScope;
  project?: SaasBrowserScope;
  environment: string;
  pathname: string;
  updateLastLogin: () => void;
  analytics?: SaasBrowserAnalytics;
};

const defaultAnalytics = SaasBrowserAnalytics.create({});

/** Appends one inline script, once per document, as main's afterInteractive Script did. */
function useInlineScript({ id, code }: { id: string; code: string | undefined }): void {
  useEffect(() => {
    if (code === undefined || document.getElementById(id)) return;
    const script = document.createElement("script");
    script.id = id;
    script.textContent = code;
    document.body.appendChild(script);
  }, [id, code]);
}

const GTM_INIT = `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;
j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;
f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','GTM-KJ4S6Z9C');`;

const CRISP_INIT = `window.$crisp=window.$crisp||[];window.CRISP_WEBSITE_ID="cca9eacd-c4d6-4258-a7fc-9606be6fd012";(function(){d=document;s=d.createElement("script");s.src="https://client.crisp.chat/l.js";s.async=1;d.getElementsByTagName("head")[0].appendChild(s);})();`;

export function ExtraFooterComponents(props: ExtraFooterComponentsProps) {
  useCrispBubblePolicy({ enabled: props.isSaas });
  useInlineScript({ id: "gtm-init", code: props.isSaas ? GTM_INIT : undefined });

  if (!props.isSaas || !props.user) return null;
  return <SignedInExtraFooterComponents {...props} user={props.user} />;
}

function sanitizeForJs(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/</g, "\\x3c")
    .replace(/>/g, "\\x3e");
}

function pendoInit({
  user,
  organization,
  project,
}: {
  user: SaasBrowserUser;
  organization: SaasBrowserScope;
  project: SaasBrowserScope;
}): string {
  return `(function(apiKey){
(function(p,e,n,d,o){var v,w,x,y,z;o=p[d]=p[d]||{};o._q=o._q||[];
v=['initialize','identify','updateOptions','pageLoad','track'];for(w=0,x=v.length;w<x;++w)(function(m){
o[m]=o[m]||function(){o._q[m===v[0]?'unshift':'push']([m].concat([].slice.call(arguments,0)));};})(v[w]);
y=e.createElement(n);y.async=!0;y.src='https://cdn.eu.pendo.io/agent/static/'+apiKey+'/pendo.js';
z=e.getElementsByTagName(n)[0];z.parentNode.insertBefore(y,z);})(window,document,'script','pendo');
pendo.initialize({visitor:{id:'${sanitizeForJs(user.id)}',email:'${sanitizeForJs(user.email ?? "")}',name:'${sanitizeForJs(user.name ?? "")}'},account:{id:'${sanitizeForJs(organization.id)}',projectName:'${sanitizeForJs(project.name)}',organizationName:'${sanitizeForJs(organization.name)}'}});
})('18f008fe-1a55-4b22-70d9-964d6e98b130');`;
}

export function SignedInExtraFooterComponents(
  props: ExtraFooterComponentsProps & { user: SaasBrowserUser },
) {
  const { environment, organization, pathname, project, updateLastLogin, user } = props;
  const analytics = props.analytics ?? defaultAnalytics;
  const hasTracked = useRef(false);
  const hasUpdatedLastLogin = useRef(false);
  const impersonated = Boolean(user.impersonator);

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
    if (!organization || !project || hasUpdatedLastLogin.current || impersonated) return;
    hasUpdatedLastLogin.current = true;
    updateLastLogin();
  }, [organization, project, updateLastLogin, impersonated]);

  useEffect(() => {
    if (!organization || !project || impersonated) return;
    return analytics.trackDashboardOpen({ user, organization, project, environment });
  }, [analytics, environment, organization, project, user, impersonated]);

  const scripted = organization && project && !impersonated;
  useInlineScript({
    id: "pendo",
    code: scripted ? pendoInit({ user, organization, project }) : undefined,
  });
  useInlineScript({
    id: "crisp",
    code: scripted && !pathname.includes("/studio") ? CRISP_INIT : undefined,
  });

  return null;
}
