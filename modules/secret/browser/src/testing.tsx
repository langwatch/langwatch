/**
 * Testing harness for mounting the Secrets screen. Uses a concrete host implementation
 * (not mocks) that records what the screen asks of the application. Internal to this
 * package only.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import {
  SecretHostApi,
  SecretHostProvider,
  type SecretFailureNotice,
  type SecretHostScope,
  type SecretSuccessNotice,
} from "./model/secret-host.ts";

export class FakeSecretHost extends SecretHostApi {
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
