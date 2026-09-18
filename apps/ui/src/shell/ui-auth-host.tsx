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
import type { PublicAppConfig } from "@langwatch/config/public-app-config";
import { readPublicAppConfig } from "@langwatch/ui-kernel/public-config";
import { UiRouteOutlet } from "@langwatch/ui-kernel/route-objects";
import { useMemo } from "react";
import { useLocation, useParams, useSearchParams } from "react-router";

/** Auth restates the public shape to break a cycle, so the projection lives here. */
function authPublicEnvironment(config: PublicAppConfig): AuthPublicEnvironment {
  return {
    BASE_HOST: config.appBaseUrl,
    DEMO_PROJECT_SLUG: config.demoProjectSlug,
    NODE_ENV: config.mode,
    IDENTITY_FRONT_DOOR: config.identityFrontDoor,
    PASSKEYS_ENABLED: config.passkeys,
    HAS_EMAIL_PROVIDER_KEY: config.capabilities.email,
    IS_SAAS: config.deployment === "saas",
    GATEWAY_BASE_URL: config.gatewayBaseUrl,
    POSTHOG_KEY: config.telemetry.posthog?.key,
    POSTHOG_HOST: config.telemetry.posthog?.host,
    RUM_ENABLED: config.telemetry.browserTracing,
    RUM_SAMPLE_RATIO: config.telemetry.sampleRatio,
    HAS_LANGWATCH_NLP_SERVICE: config.capabilities.nlp,
    HAS_LANGEVALS_ENDPOINT: config.capabilities.langevals,
    STRIPE_LICENSE_PAYMENT_LINK_URL: config.licensePaymentUrl,
    NEXTAUTH_PROVIDER: config.authProvider,
  };
}

class ShellAuthHost extends AuthHostApi {
  constructor(
    private readonly config: PublicAppConfig,
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
  const [config] = useMemo(() => [readPublicAppConfig(document)], []);

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
