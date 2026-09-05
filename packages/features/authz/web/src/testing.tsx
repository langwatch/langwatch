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
import { UiCapabilityContextProvider } from "@langwatch/ui-host/capabilities";
import { uiSlots } from "@langwatch/ui-host/slots";
import { createUiCapabilitiesFromHost } from "@langwatch/ui-host/testing";
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
/**
 * A composition that filled the sales slot, the way the browser application
 * does. The screens under test only ask for the block by name; what an
 * application without an enterprise half renders is `ui-host`'s own suite.
 */
const filledSlots = {
  ...createUiCapabilitiesFromHost({ route: () => ({ params: {}, query: {} }), navigate: () => {} }),
  slots: uiSlots({
    components: {
      contactSales: () => <div data-testid="contact-sales-block">Need more?</div>,
    },
  }),
};

export function renderWithAuthzHost(
  element: ReactElement,
  host: FakeAuthzHost = new FakeAuthzHost(),
) {
  return {
    host,
    ...render(
      <ChakraProvider value={defaultSystem}>
        <UiCapabilityContextProvider value={filledSlots}>
          <AuthzHostProvider value={host}>{element}</AuthzHostProvider>
        </UiCapabilityContextProvider>
      </ChakraProvider>,
    ),
  };
}
