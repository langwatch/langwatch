/**
 * What this package's suites mount the SCIM screen inside.
 *
 * The host port is an abstract class, so a test constructs one rather than
 * mocking a module: the fake below RECORDS what the screen asked the
 * application to say and answers the base URL an identity provider posts to,
 * which is exactly the surface the real adapter answers.
 *
 * Not exported from the package. A test imports it relatively; nothing outside
 * this package has any business constructing a host.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";

import {
  ScimHostPort,
  ScimHostProvider,
  type ScimFailureNotice,
  type ScimSuccessNotice,
} from "./model/scim-host";

export class FakeScimHost extends ScimHostPort {
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
export function renderWithScimHost(
  element: ReactElement,
  host: FakeScimHost = new FakeScimHost(),
) {
  return {
    host,
    ...render(
      <ChakraProvider value={defaultSystem}>
        <ScimHostProvider value={host}>{element}</ScimHostProvider>
      </ChakraProvider>,
    ),
  };
}
