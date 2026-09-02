/**
 * The harness a suite in this package mounts a screen inside.
 *
 * The same shape `@langwatch/gateway-web` introduced and every family since
 * has copied: one place that knows what a front-door screen needs above it, so
 * a test states what it is ABOUT rather than restating the composition.
 *
 * NOT PUBLISHED. There is no subpath export for it — `apps/ui` composes the
 * real host, and this exists for the suites next to the screens.
 */

import type { ReactElement, ReactNode } from "react";

import {
  AuthHostPort,
  AuthHostProvider,
  type AuthPublicEnvironment,
  type AuthRouteReading,
} from "./model/auth-host";

/** The deployment a test runs against unless it says otherwise. */
export const TEST_PUBLIC_ENVIRONMENT: AuthPublicEnvironment = {
  BASE_HOST: "http://localhost:5560",
  DEMO_PROJECT_SLUG: undefined,
  NODE_ENV: "test",
  IDENTITY_FRONT_DOOR: false,
  PASSKEYS_ENABLED: false,
  HAS_EMAIL_PROVIDER_KEY: true,
  IS_SAAS: false,
  GATEWAY_BASE_URL: "http://localhost:5563",
  POSTHOG_KEY: undefined,
  POSTHOG_HOST: undefined,
  RUM_ENABLED: false,
  RUM_SAMPLE_RATIO: 0,
  HAS_LANGWATCH_NLP_SERVICE: false,
  HAS_LANGEVALS_ENDPOINT: false,
  STRIPE_LICENSE_PAYMENT_LINK_URL: undefined,
};

export type TestAuthHostOptions = {
  publicEnvironment?: Partial<AuthPublicEnvironment>;
  route?: Partial<AuthRouteReading>;
};

/** A host that answers from values a test wrote, and nothing else. */
export class TestAuthHost extends AuthHostPort {
  static create(options: TestAuthHostOptions = {}): TestAuthHost {
    return new TestAuthHost(
      { ...TEST_PUBLIC_ENVIRONMENT, ...options.publicEnvironment },
      { pathname: "/auth/signin", params: {}, query: {}, ...options.route },
    );
  }

  private constructor(
    private readonly environment: AuthPublicEnvironment,
    private readonly reading: AuthRouteReading,
  ) {
    super();
  }

  publicEnvironment(): AuthPublicEnvironment {
    return this.environment;
  }

  route(): AuthRouteReading {
    return this.reading;
  }
}

/** Mounts a fragment inside a host built from the address a test names. */
export function WithTestAuthHost({
  children,
  ...options
}: TestAuthHostOptions & { children: ReactNode }): ReactElement {
  return <AuthHostProvider value={TestAuthHost.create(options)}>{children}</AuthHostProvider>;
}
