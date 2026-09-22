// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// Test harness for mounting single sign-on sections: a fake host that records
// what it was told. Internal only, not exported from the package.

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";

import {
  SsoHostApi,
  SsoHostProvider,
  type SsoFailureNotice,
  type SsoRouteReading,
  type SsoTestSignInResult,
} from "./model/sso-host.ts";

export class FakeSsoHost extends SsoHostApi {
  readonly failures: SsoFailureNotice[] = [];
  /** Every test sign-in this host was asked to start, in order. */
  readonly testSignIns: {
    connectionId: string;
    callbackQuery: Record<string, string | undefined>;
  }[] = [];

  constructor(
    private readonly options: {
      organizationId?: string | null;
      currentUserAddress?: string | null;
      /** Whether the reader holds `sso:manage`; they do unless a test says not. */
      canManage?: boolean;
      query?: Record<string, string | undefined>;
      /** What the sign-in answers, or throws when it is an error. */
      testSignIn?: SsoTestSignInResult | Error;
    } = {},
  ) {
    super();
  }

  organizationId(): string | undefined {
    if (this.options.organizationId === null) return void 0;

    return this.options.organizationId ?? "org-1";
  }

  failed(failure: SsoFailureNotice): void {
    this.failures.push(failure);
  }

  canManage(): boolean {
    return this.options.canManage ?? true;
  }

  currentUserAddress(): string | undefined {
    if (this.options.currentUserAddress === null) return void 0;

    return this.options.currentUserAddress ?? "ana@acme.com";
  }

  route(): SsoRouteReading {
    return { query: this.options.query ?? {} };
  }

  async testSignIn(options: {
    connectionId: string;
    callbackQuery: Record<string, string | undefined>;
  }): Promise<SsoTestSignInResult> {
    this.testSignIns.push(options);
    const answer = this.options.testSignIn;
    if (answer instanceof Error) throw answer;

    return Promise.resolve(answer ?? {});
  }

  /** The one aliasing the engine actually emits, so the hook is exercised. */
  normalizeSignInErrorCode(code: string): string {
    return code === "account_not_linked" ? "OAuthAccountNotLinked" : code;
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
