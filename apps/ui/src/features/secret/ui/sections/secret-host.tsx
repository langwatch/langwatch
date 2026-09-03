/**
 * What the Secrets screen is mounted inside: the tRPC Provider its hooks
 * run on, and the host port for project, grant, feedback and switcher. No
 * page-level grant — a `secrets:view`-only reader still sees which secrets exist.
 */

import {
  SecretHostProvider,
  secretApi,
  type SecretHostPort,
} from "@langwatch/secret-web/screens/secret";
import { useMemo, type ReactNode } from "react";
import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import { UiProjectSwitcher } from "../../../chrome";

export function SecretHost({ children }: { children: ReactNode }) {
  const { session, feedback } = useUiCapabilities();
  const activeScope = session.activeScope();

  const host = useMemo<SecretHostPort>(
    () => ({
      scope: () => ({
        projectId: activeScope.projectId ?? void 0,
        projectName: void 0,
      }),
      hasPermission: (permission) => session.hasPermission(permission),
      succeeded: (notice) => feedback.succeeded(notice),
      failed: (failure) => feedback.failed(failure),
      // The recorded gap, closed: the chrome layout route mounts the
      // navigation host above every settings address, so the switcher the
      // header draws is the one this screen is handed.
      projectSwitcher: () => <UiProjectSwitcher />,
    }),
    [activeScope.projectId, session, feedback],
  );

  return <SecretHostProvider value={host}>{children}</SecretHostProvider>;
}

export { secretApi };
