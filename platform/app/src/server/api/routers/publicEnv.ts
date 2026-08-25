import { resolveGatewayBaseUrl } from "@ee/governance/services/gatewayUrl";
import { resolveAuthProvider } from "@ee/sso/sso-gate";
import { RUM_DEFAULT_SAMPLE_RATIO } from "@langwatch/react-rum/constants";
import { z } from "zod";
import {
  deploymentOffersPasskeys,
  deploymentOffersTwoStepVerification,
} from "~/server/app-layer/identity/signin-method-policy";
import { signInRouterMode } from "~/server/better-auth/signInRouterShadow";
import { env } from "../../../env.mjs";
import { hasEmailProvider } from "../../mailer/providers";
import { publicProcedure } from "../trpc";

const isOpsSidebarEmail = (userEmail: string | null | undefined) => {
  const allowList = env.SHOW_OPS_IN_MAIN_SIDEBAR;
  if (!allowList || !userEmail) return false;
  const normalized = userEmail.toLowerCase().trim();
  return allowList
    .split(",")
    .some((e: string) => e.trim().toLowerCase() === normalized);
};

export const publicEnvRouter = publicProcedure
  .input(z.object({}).passthrough())
  .noPermission({
    reason: "exposes only the PUBLIC_* env allowlist; no tenant data",
  })
  .query(async ({ ctx }) => {
    // Warning: be very careful with the env vars you expose here

    const publicEnvVars = {
      BASE_HOST: env.BASE_HOST,
      // ADR-027: report "email" whenever the license gate denies SSO, so
      // the sign-in page renders the email form and never auto-redirects to
      // a disabled IdP. `resolveAuthProvider()` is the single source of
      // truth — never read `env.NEXTAUTH_PROVIDER` directly here.
      NEXTAUTH_PROVIDER: await resolveAuthProvider(),
      // ADR-117 §7: whether the identifier-first screens are the auth screens
      // on this deployment. A derived boolean rather than the flag's value,
      // because the only thing a browser may act on is "are these screens
      // live" — the router also runs in shadow, and screens never render
      // then. `signInRouterMode()` is the single source of truth for the
      // flag, so the live path and the screens can never disagree.
      IDENTITY_FRONT_DOOR: signInRouterMode() === "enforce",
      // Whether this deployment mounted the passkey plugin at boot. A derived
      // boolean rather than the raw setting, because the only thing a browser
      // may act on is "is there an endpoint behind the button" — offering to
      // create a passkey where the plugin was never mounted is an offer we
      // cannot honour. Same read the plugin registration makes, so the button
      // and the endpoint cannot disagree.
      PASSKEYS_ENABLED: deploymentOffersPasskeys(),
      // Whether this deployment mounted the two-factor plugin at boot (D06).
      // Derived for the same reason `PASSKEYS_ENABLED` is: the only thing a
      // browser may act on is "is there an endpoint behind the button", and
      // offering a setup where the plugin was never registered is an offer we
      // cannot honour. Same read the plugin registration makes.
      MFA_ENROLLMENT_OPEN: deploymentOffersTwoStepVerification(),
      DEMO_PROJECT_SLUG: env.DEMO_PROJECT_SLUG,
      NODE_ENV: env.NODE_ENV,

      HAS_EMAIL_PROVIDER_KEY: hasEmailProvider(),
      IS_SAAS: env.IS_SAAS,
      // AI Gateway public base URL (no /v1 suffix) for the copy-paste SDK
      // snippets in VirtualKeyUsageSnippet. Self-hosted deployments must see
      // their own ingress, not the SaaS default. Shares the single resolver
      // used by the CLI surfaces (login ceremony, personal-VK reveal) so the
      // public SDK URL and CLI URL can't drift.
      GATEWAY_BASE_URL: resolveGatewayBaseUrl({
        publicUrl: env.LW_GATEWAY_PUBLIC_URL,
        baseUrl: env.LW_GATEWAY_BASE_URL,
        isSaas: env.IS_SAAS,
      }),
      SHOW_OPS_IN_MAIN_SIDEBAR: isOpsSidebarEmail(ctx.session?.user?.email),
      POSTHOG_KEY: env.POSTHOG_KEY,
      POSTHOG_HOST: env.POSTHOG_HOST,
      // Whether the browser should trace itself (ADR-058). A flag rather than a
      // URL: the browser always exports to this app's own origin, so there is
      // no endpoint for the client to know.
      //
      // Gated on the collector as well as the flag, because the ingest route
      // 404s without one. Told yes on its own, every open tab would export on a
      // batch timer into a permanent 404 — work and noise for telemetry that
      // has nowhere to land. Both are required, so the browser stays quiet
      // until there is something to be quiet about.
      RUM_ENABLED: !!env.RUM_ENABLED && !!env.OTEL_EXPORTER_OTLP_ENDPOINT,
      // Share of browser sessions the client should record. Server-side
      // because it is a cost lever operators pull without shipping a bundle,
      // and because the browser has no other way to learn it.
      RUM_SAMPLE_RATIO: env.RUM_SAMPLE_RATIO ?? RUM_DEFAULT_SAMPLE_RATIO,
      HAS_LANGWATCH_NLP_SERVICE:
        !!env.LANGWATCH_NLP_SERVICE || !!env.LANGWATCH_NLP_LAMBDA_CONFIG,
      HAS_LANGEVALS_ENDPOINT: !!env.LANGEVALS_ENDPOINT,
      STRIPE_LICENSE_PAYMENT_LINK_URL: env.STRIPE_LICENSE_PAYMENT_LINK_URL,
    };

    return publicEnvVars;
  });
