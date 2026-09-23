// Test harness for mounting the SCIM screen: a fake host that records requests
// and answers the base URL. Internal only, not exported.

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";

import {
  ScimHostApi,
  ScimHostProvider,
  type ScimFailureNotice,
  type ScimRouteReading,
  type ScimSuccessNotice,
} from "./model/scim-host.ts";

export class FakeScimHost extends ScimHostApi {
  readonly successes: ScimSuccessNotice[] = [];
  readonly failures: ScimFailureNotice[] = [];
  /** Every query string the screen asked for, in order. */
  readonly queries: Readonly<Record<string, string | undefined>>[] = [];

  constructor(
    private readonly options: {
      organizationId?: string | null;
      scimBaseUrl?: string;
      query?: Readonly<Record<string, string | undefined>>;
    } = {},
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

  route(): ScimRouteReading {
    return { query: this.queries.at(-1) ?? this.options.query ?? {} };
  }

  setQuery(next: Readonly<Record<string, string | undefined>>): void {
    this.queries.push(next);
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
