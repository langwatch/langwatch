// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * SSO's answer to the port its screens declare: every method projects a
 * `@langwatch/browser-host` capability. ARCHITECTURE.md §10.1.
 */
import {
  useUiCapabilities,
  useUiScope,
  type UiFeedback,
} from "@langwatch/browser-host/capabilities";
import { useMemo, type ReactNode } from "react";

import { SsoHostApi, SsoHostProvider, type SsoFailureNotice } from "../model/sso-host.ts";

class CapabilitySsoHost extends SsoHostApi {
  constructor(
    private readonly orgId: string | undefined,
    private readonly feedback: UiFeedback,
  ) {
    super();
  }

  organizationId(): string | undefined {
    return this.orgId;
  }

  failed(failure: SsoFailureNotice): void {
    this.feedback.failed(failure);
  }
}

/**
 * The mount the declaration names: one provider above the routed tree.
 * Default-exported because that is what `mounts.load` resolves.
 */
export default function SsoHostMount({ children }: { children?: ReactNode }) {
  const { feedback } = useUiCapabilities();
  const { organizationId } = useUiScope().activeScope();

  const host = useMemo(
    () => new CapabilitySsoHost(organizationId ?? void 0, feedback),
    [organizationId, feedback],
  );

  return <SsoHostProvider value={host}>{children}</SsoHostProvider>;
}
