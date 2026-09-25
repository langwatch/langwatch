/**
 * The shell's answer to auth's declared host port. The front door reads the
 * deployment's public shape, its own address, and somewhere to report a
 * failure — none of which auth may reach for itself.
 */

import {
  AuthHostApi,
  AuthHostProvider,
  type AuthFailureNotice,
  type AuthPublicEnvironment,
  type AuthRouteReading,
} from "@langwatch/auth-browser/auth";
import { useOptionalUiCapabilities } from "@langwatch/browser-host/capabilities";
import { readPublicAppConfig } from "@langwatch/ui-kernel/public-config";
import { UiRouteOutlet } from "@langwatch/ui-kernel/route-objects";
import { useMemo } from "react";
import { useLocation, useParams, useSearchParams } from "react-router";

import { parseUiFeatureConfig, type UiFeatureConfig } from "../ui-feature-config";

/** Auth restates the public shape to break a cycle, so the projection lives here. */
function authPublicEnvironment(config: UiFeatureConfig): AuthPublicEnvironment {
  return {
    BASE_HOST: config.process.appBaseUrl ?? window.location.origin,
    DEMO_PROJECT_SLUG: config.authz.demoProjectSlug,
    NODE_ENV: config.process.mode,
    IDENTITY_FRONT_DOOR: config.auth.identityFrontDoor,
    PASSKEYS_ENABLED: config.auth.passkeys,
    HAS_EMAIL_PROVIDER_KEY: config.notification.email,
    IS_SAAS: config.process.deployment === "saas",
    GATEWAY_BASE_URL: config.gateway.gatewayBaseUrl,
    POSTHOG_KEY: config.ops.posthog?.key,
    POSTHOG_HOST: config.ops.posthog?.host,
    RUM_ENABLED: config.process.browserTracing,
    RUM_SAMPLE_RATIO: config.process.sampleRatio,
    HAS_LANGWATCH_NLP_SERVICE: config.process.nlp,
    HAS_LANGEVALS_ENDPOINT: config.evaluation.langevals,
    STRIPE_LICENSE_PAYMENT_LINK_URL: config.billing.licensePaymentUrl,
    NEXTAUTH_PROVIDER: config.auth.authProvider,
  };
}

class ShellAuthHost extends AuthHostApi {
  constructor(
    private readonly config: UiFeatureConfig,
    private readonly reading: AuthRouteReading,
    private readonly report: (failure: AuthFailureNotice) => void,
  ) {
    super();
  }

  publicEnvironment(): AuthPublicEnvironment {
    return authPublicEnvironment(this.config);
  }

  route(): AuthRouteReading {
    return this.reading;
  }

  failed(failure: AuthFailureNotice): void {
    this.report(failure);
  }
}

export default function UiAuthHost() {
  const capabilities = useOptionalUiCapabilities();
  const location = useLocation();
  const params = useParams();
  const [search] = useSearchParams();
  const [config] = useMemo(() => [parseUiFeatureConfig(readPublicAppConfig(document))], []);

  const host = useMemo(() => {
    const reading: AuthRouteReading = {
      pathname: location.pathname,
      params,
      query: Object.fromEntries(search.entries()),
    };
    return new ShellAuthHost(config, reading, (failure) => capabilities?.feedback?.failed(failure));
  }, [config, location.pathname, params, search, capabilities]);

  return (
    <AuthHostProvider value={host}>
      <UiRouteOutlet />
    </AuthHostProvider>
  );
}
