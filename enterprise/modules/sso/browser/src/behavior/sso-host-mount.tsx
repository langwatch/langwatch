// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * SSO's answer to the port its screens declare: every method projects a
 * `@langwatch/browser-host` capability. ARCHITECTURE.md §10.1.
 */
import {
  UiCapabilityUnavailableError,
  useUiCapabilities,
  useUiScope,
  type UiFeedback,
  type UiRoute,
  type UiSession,
} from "@langwatch/browser-host/capabilities";
import { useMemo, type ReactNode } from "react";

import {
  SsoHostApi,
  SsoHostProvider,
  type SsoFailureNotice,
  type SsoRouteReading,
  type SsoTestSignInResult,
} from "../model/sso-host.ts";

/**
 * Auth's half of the host: starting a sign-in that names a connection, and
 * spelling a sign-in code the one way. Inert until the shell wires it from
 * `modules/auth/browser`'s published capability (handoff §10) — the sign-in
 * refuses loudly rather than reporting a test nobody ran as a success.
 */
export type SsoAuthCapability = {
  testSignIn(options: {
    connectionId: string;
    callbackQuery: Readonly<Record<string, string | undefined>>;
  }): Promise<SsoTestSignInResult>;
  normalizeSignInErrorCode(code: string): string;
};

const INERT_AUTH: SsoAuthCapability = {
  testSignIn() {
    throw new UiCapabilityUnavailableError("sso test sign-in");
  },
  normalizeSignInErrorCode(code) {
    return code;
  },
};

class CapabilitySsoHost extends SsoHostApi {
  constructor(
    private readonly deps: {
      orgId: string | undefined;
      feedback: UiFeedback;
      route: UiRoute;
      session: UiSession;
      auth: SsoAuthCapability;
    },
  ) {
    super();
  }

  organizationId(): string | undefined {
    return this.deps.orgId;
  }

  failed(failure: SsoFailureNotice): void {
    this.deps.feedback.failed(failure);
  }

  currentUserAddress(): string | undefined {
    return this.deps.session.currentUser()?.email ?? void 0;
  }

  route(): SsoRouteReading {
    return { query: this.deps.route.reading().query };
  }

  async testSignIn(options: {
    connectionId: string;
    callbackQuery: Readonly<Record<string, string | undefined>>;
  }): Promise<SsoTestSignInResult> {
    return this.deps.auth.testSignIn(options);
  }

  normalizeSignInErrorCode(code: string): string {
    return this.deps.auth.normalizeSignInErrorCode(code);
  }
}

/**
 * The mount the declaration names: one provider above the routed tree.
 * Default-exported because that is what `mounts.load` resolves.
 */
export default function SsoHostMount({ children }: { children?: ReactNode }) {
  const { feedback, route, session } = useUiCapabilities();
  const { organizationId } = useUiScope().activeScope();

  const host = useMemo(
    () =>
      new CapabilitySsoHost({
        orgId: organizationId ?? void 0,
        feedback,
        route,
        session,
        auth: INERT_AUTH,
      }),
    [organizationId, feedback, route, session],
  );

  return <SsoHostProvider value={host}>{children}</SsoHostProvider>;
}
