/**
 * Ops' answer to the port the checkup declares: every method projects a
 * `@langwatch/browser-host` capability, so the module mounts it, not the
 * application. ARCHITECTURE.md §10.1.
 */

import {
  useUiCapabilities,
  useUiDeployment,
  useUiScope,
  type UiFeedback,
} from "@langwatch/browser-host/capabilities";
import { describeError } from "@langwatch/browser-host/errors";
import { useMemo, type ReactNode } from "react";

import {
  CheckupHostApi,
  CheckupHostProvider,
  type CheckupFailureNotice,
} from "../model/checkup-host.ts";

class CapabilityCheckupHost extends CheckupHostApi {
  constructor(
    private readonly deps: {
      organizationId: string | undefined;
      isSaaS: boolean;
      mayManageOrganization: boolean;
      feedback: UiFeedback;
    },
  ) {
    super();
  }

  organizationId(): string | undefined {
    return this.deps.organizationId;
  }

  isSaaS(): boolean {
    return this.deps.isSaaS;
  }

  canManageOrganization(): boolean {
    return this.deps.mayManageOrganization;
  }

  failed(failure: CheckupFailureNotice): void {
    this.deps.feedback.failed(failure);
  }

  describeFailure(failure: CheckupFailureNotice): string {
    return describeError(failure);
  }
}

/** One provider above the routed tree; default-exported because `mounts.load` resolves that. */
export default function CheckupHostMount({ children }: { children?: ReactNode }) {
  const { session, feedback } = useUiCapabilities();
  const { isSaaS } = useUiDeployment();
  const { organizationId } = useUiScope().activeScope();
  const mayManageOrganization = session.hasPermission("organization:manage");

  const host = useMemo(
    () =>
      new CapabilityCheckupHost({
        organizationId: organizationId ?? void 0,
        isSaaS,
        mayManageOrganization,
        feedback,
      }),
    [organizationId, isSaaS, mayManageOrganization, feedback],
  );

  return <CheckupHostProvider value={host}>{children}</CheckupHostProvider>;
}
