// Test harness for mounting the SCIM screen: a fake host that records requests
// and answers the base URL. Internal only, not exported.

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";

import {
  ScimHostApi,
  ScimHostProvider,
  type ScimFailureNotice,
  type ScimSuccessNotice,
} from "./model/scim-host.ts";

export class FakeScimHost extends ScimHostApi {
  readonly successes: ScimSuccessNotice[] = [];
  readonly failures: ScimFailureNotice[] = [];

  constructor(
    private readonly options: { organizationId?: string | null; scimBaseUrl?: string } = {},
  ) {
    super();
  }

  organizationId(): string | undefined {
    if (this.options.organizationId === null) return void 0;
    return this.options.organizationId ?? "org-1";
  }

  scimBaseUrl(): string {
    return this.options.scimBaseUrl ?? "https://app.langwatch.test/api/scim/v2";
  }

  succeeded(notice: ScimSuccessNotice): void {
    this.successes.push(notice);
  }

  failed(failure: ScimFailureNotice): void {
    this.failures.push(failure);
  }
}

/** Renders the screen inside the Design System's provider and a host. */
export function renderWithScimHost(element: ReactElement, host: FakeScimHost = new FakeScimHost()) {
  return {
    host,
    ...render(
      <ChakraProvider value={defaultSystem}>
        <ScimHostProvider value={host}>{element}</ScimHostProvider>
      </ChakraProvider>,
    ),
  };
}
