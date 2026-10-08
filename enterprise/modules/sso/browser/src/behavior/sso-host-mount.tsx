// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * SSO's answer to the port its screens declare: every method projects a
 * `@langwatch/browser-host` capability. ARCHITECTURE.md §10.1.
 */
import {
  normalizeSignInErrorCode,
  SsoTestSignInToken,
  type SsoTestSignInOperations,
} from "@langwatch/auth-contract";
import {
  UiCapabilityUnavailableError,
  useUiCapabilities,
  useUiScope,
  type UiFeedback,
  type UiRoute,
  type UiSession,
} from "@langwatch/browser-host/capabilities";
import type { UiDrawerToken } from "@langwatch/browser-host/declarations";
import { useLentOperations } from "@langwatch/browser-host/lent";
import { useDrawer } from "@langwatch/browser-host/use-drawer";
import { useMemo, type ReactNode } from "react";

import {
  SsoHostApi,
  SsoHostProvider,
  type SsoFailureNotice,
  type SsoRouteReading,
  type SsoSuccessNotice,
  type SsoTestSignInResult,
} from "../model/sso-host.ts";

/** Auth lends the sign-in that names a connection; unlent, it refuses rather than fake a pass. */
type SsoTestSignIn = SsoTestSignInOperations["testSignIn"];

const INERT_TEST_SIGN_IN: SsoTestSignIn = () => {
  throw new UiCapabilityUnavailableError("sso test sign-in");
};

/** Every control on the page, as ADR-122 gates them. */
const SSO_MANAGE_PERMISSION = "sso:manage";
const SSO_VIEW_PERMISSION = "sso:view";

class CapabilitySsoHost extends SsoHostApi {
  constructor(
    private readonly deps: {
      orgId: string | undefined;
      feedback: UiFeedback;
      route: UiRoute;
      session: UiSession;
      testSignIn: SsoTestSignIn;
      openOverlay: <Props>(drawer: UiDrawerToken<Props>, props?: Partial<Props>) => void;
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

  succeeded(notice: SsoSuccessNotice): void {
    this.deps.feedback.succeeded(notice);
  }

  canManage(): boolean {
    return this.deps.session.hasPermission(SSO_MANAGE_PERMISSION);
  }

  canView(): boolean {
    return this.deps.session.hasPermission(SSO_VIEW_PERMISSION);
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
    return this.deps.testSignIn(options);
  }

  normalizeSignInErrorCode(code: string): string {
    return normalizeSignInErrorCode(code) ?? code;
  }

  openOverlay<Props>(drawer: UiDrawerToken<Props>, props?: Partial<Props>): void {
    this.deps.openOverlay(drawer, props);
  }
}

/**
 * The mount the declaration names: one provider above the routed tree.
 * Default-exported because that is what `mounts.load` resolves.
 */
export default function SsoHostMount({ children }: { children?: ReactNode }) {
  const { feedback, route, session } = useUiCapabilities();
  const { organizationId } = useUiScope().activeScope();
  const loadSignIn = useLentOperations(SsoTestSignInToken);
  const { openDrawer } = useDrawer();

  const host = useMemo(
    () =>
      new CapabilitySsoHost({
        orgId: organizationId ?? void 0,
        feedback,
        route,
        session,
        testSignIn:
          loadSignIn === undefined
            ? INERT_TEST_SIGN_IN
            : async (options) => (await loadSignIn()).testSignIn(options),
        openOverlay: (drawer, props) => openDrawer(drawer, props),
      }),
    [organizationId, feedback, route, session, loadSignIn, openDrawer],
  );

  return <SsoHostProvider value={host}>{children}</SsoHostProvider>;
}
