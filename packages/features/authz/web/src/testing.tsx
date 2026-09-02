/**
 * What this package's screen suites mount a screen inside.
 *
 * The host port is an abstract class, so a test constructs one rather than
 * mocking a module: the fake below RECORDS what a screen asked the application
 * to do — what it reported as done, what it reported as failed — which is
 * exactly the surface the real adapter answers. The same shape
 * `@langwatch/gateway-web`'s `testing.tsx` introduced.
 *
 * Not exported from the package. A test imports it relatively; nothing outside
 * this package has any business constructing a host.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import {
  AuthzHostPort,
  AuthzHostProvider,
  type AuthzFailureNotice,
  type AuthzHostScope,
  type AuthzPlanReading,
  type AuthzSuccessNotice,
} from "./model/authz-host";

export class FakeAuthzHost extends AuthzHostPort {
  readonly successes: AuthzSuccessNotice[] = [];
  readonly failures: AuthzFailureNotice[] = [];

  constructor(
    private readonly options: {
      scope?: AuthzHostScope;
      grants?: ReadonlySet<string>;
      plan?: AuthzPlanReading;
    } = {},
  ) {
    super();
  }

  scope(): AuthzHostScope {
    return this.options.scope ?? { organizationId: "org-1" };
  }

  hasPermission(permission: string): boolean {
    return (this.options.grants ?? new Set(["organization:manage"])).has(permission);
  }

  plan(): AuthzPlanReading {
    return this.options.plan ?? { isEnterprise: true, isLoading: false };
  }

  succeeded(notice: AuthzSuccessNotice): void {
    this.successes.push(notice);
  }

  failed(failure: AuthzFailureNotice): void {
    this.failures.push(failure);
  }
}

/** Renders a screen inside the Design System's provider and a host. */
export function renderWithAuthzHost(
  element: ReactElement,
  host: FakeAuthzHost = new FakeAuthzHost(),
) {
  return {
    host,
    ...render(
      <ChakraProvider value={defaultSystem}>
        <AuthzHostProvider value={host}>{element}</AuthzHostProvider>
      </ChakraProvider>,
    ),
  };
}
