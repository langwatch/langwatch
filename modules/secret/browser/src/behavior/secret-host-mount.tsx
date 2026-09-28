/**
 * Secret's answer to the port its screen declares: every method projects a
 * `@langwatch/browser-host` capability, so the module mounts it, not the
 * application. ARCHITECTURE.md §10.1.
 */

import {
  useUiCapabilities,
  useUiDeclarations,
  useUiScope,
  type UiFeedback,
  type UiSession,
} from "@langwatch/browser-host/capabilities";
import type { UiProjectSwitcherProps } from "@langwatch/browser-host/declarations";
import { lazy, Suspense, useMemo, type ComponentType, type ReactNode } from "react";

import {
  SecretHostApi,
  SecretHostProvider,
  type SecretFailureNotice,
  type SecretHostScope,
  type SecretSuccessNotice,
} from "../model/secret-host.ts";

class CapabilitySecretHost extends SecretHostApi {
  private readonly projectId: string | undefined;
  private readonly session: UiSession;
  private readonly feedback: UiFeedback;
  private readonly Switcher: ComponentType<UiProjectSwitcherProps> | undefined;

  constructor(options: {
    projectId: string | undefined;
    session: UiSession;
    feedback: UiFeedback;
    Switcher: ComponentType<UiProjectSwitcherProps> | undefined;
  }) {
    super();
    this.projectId = options.projectId;
    this.session = options.session;
    this.feedback = options.feedback;
    this.Switcher = options.Switcher;
  }

  scope(): SecretHostScope {
    return { projectId: this.projectId, projectName: void 0 };
  }

  hasPermission(permission: string): boolean {
    return this.session.hasPermission(permission);
  }

  succeeded(notice: SecretSuccessNotice): void {
    this.feedback.succeeded(notice);
  }

  failed(failure: SecretFailureNotice): void {
    this.feedback.failed(failure);
  }

  /** Project's lent switcher (ARCHITECTURE §10); null only where no module lends one. */
  projectSwitcher(): ReactNode | null {
    const { Switcher } = this;
    if (!Switcher) return null;
    return (
      <Suspense fallback={null}>
        <Switcher />
      </Suspense>
    );
  }
}

/**
 * The mount the declaration names: one provider above the routed tree, so a
 * peer's screen reading this port finds it too. Default-exported because that
 * is what `mounts.load` resolves.
 */
export default function SecretHostMount({ children }: { children?: ReactNode }) {
  const { session, feedback } = useUiCapabilities();
  const { projectId } = useUiScope().activeScope();
  const declarations = useUiDeclarations();
  // `lazy` once per declaration, never per render, so the switcher is not remounted.
  const Switcher = useMemo(() => {
    const [lent] = declarations.declared("projectSwitcher");
    return lent ? lazy(lent.capability.load) : void 0;
  }, [declarations]);
  const host = useMemo(
    () => new CapabilitySecretHost({ projectId: projectId ?? void 0, session, feedback, Switcher }),
    [projectId, session, feedback, Switcher],
  );
  return <SecretHostProvider value={host}>{children}</SecretHostProvider>;
}
