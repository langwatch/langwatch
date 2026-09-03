/**
 * What this package's suites mount the screen inside.
 *
 * The host port is an abstract class, so a test constructs one rather than
 * mocking a module: the fake below RECORDS what the screen asked the application
 * to do, which is exactly the surface the real adapter answers.
 *
 * Not exported from the package. A test imports it relatively; nothing outside
 * this package has any business constructing a host.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import {
  SecretHostPort,
  SecretHostProvider,
  type SecretFailureNotice,
  type SecretHostScope,
  type SecretSuccessNotice,
} from "./model/secret-host";

export class FakeSecretHost extends SecretHostPort {
  readonly successes: SecretSuccessNotice[] = [];
  readonly failures: SecretFailureNotice[] = [];

  constructor(
    private readonly options: {
      scope?: Partial<SecretHostScope>;
      grants?: ReadonlySet<string>;
      projectSwitcher?: ReactNode | null;
    } = {},
  ) {
    super();
  }

  scope(): SecretHostScope {
    return { projectId: "proj-1", projectName: "Web App", ...this.options.scope };
  }

  hasPermission(permission: string): boolean {
    return (this.options.grants ?? new Set(["secrets:manage", "secrets:view"])).has(permission);
  }

  succeeded(notice: SecretSuccessNotice): void {
    this.successes.push(notice);
  }

  failed(failure: SecretFailureNotice): void {
    this.failures.push(failure);
  }

  projectSwitcher(): ReactNode | null {
    return this.options.projectSwitcher ?? null;
  }
}

/** Renders the screen inside the Design System's provider and a host. */
export function renderWithSecretHost(
  element: ReactElement,
  host: FakeSecretHost = new FakeSecretHost(),
) {
  return {
    host,
    ...render(
      <ChakraProvider value={defaultSystem}>
        <SecretHostProvider value={host}>{element}</SecretHostProvider>
      </ChakraProvider>,
    ),
  };
}
