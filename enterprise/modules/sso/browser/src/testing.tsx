// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// Test harness for mounting single sign-on sections: a fake host that records
// what it was told. Internal only, not exported from the package.

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";

import { SsoHostApi, SsoHostProvider, type SsoFailureNotice } from "./model/sso-host.ts";

export class FakeSsoHost extends SsoHostApi {
  readonly failures: SsoFailureNotice[] = [];

  constructor(private readonly options: { organizationId?: string | null } = {}) {
    super();
  }

  organizationId(): string | undefined {
    if (this.options.organizationId === null) return void 0;

    return this.options.organizationId ?? "org-1";
  }

  failed(failure: SsoFailureNotice): void {
    this.failures.push(failure);
  }
}

/** Renders a section inside the design system's provider and a host. */
export function renderWithSsoHost(element: ReactElement, host: FakeSsoHost = new FakeSsoHost()) {
  return {
    host,
    ...render(
      <ChakraProvider value={defaultSystem}>
        <SsoHostProvider value={host}>{element}</SsoHostProvider>
      </ChakraProvider>,
    ),
  };
}
