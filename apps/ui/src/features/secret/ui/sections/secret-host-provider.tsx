/**
 * What the Secrets screen is mounted inside.
 *
 * Two things go around `/settings/secrets`: the tRPC Provider the package's own
 * hooks run on, and the host port that answers for the project, the one grant,
 * the two notices and the project switcher. A screen stays a screen module.
 *
 * The project NAME is read from the organization graph the shell already holds,
 * on the same `organization.getAll` cache entry every other half of the product
 * lands on — but only because the port declares it; the screen renders the name
 * nowhere today, and it is on the port so the switcher gap can close without a
 * port change.
 */

import { SecretHostProvider, secretApi } from "@langwatch/secret-web/screens/secret";
import { useMemo, type ComponentType, type ReactNode } from "react";
import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import { UiProjectSwitcher } from "../../../chrome";
import { UiSecretHost } from "../../behavior/secret-host.adapter";

function SecretHost({ children }: { children: ReactNode }) {
  const { session, feedback } = useUiCapabilities();
  const activeScope = session.activeScope();

  const host = useMemo(
    () =>
      UiSecretHost.create(
        {
          scope: {
            projectId: activeScope.projectId ?? void 0,
            projectName: void 0,
          },
          // The recorded gap, closed: the chrome layout route mounts the
          // navigation host above every settings address, so the switcher the
          // header draws is the one this screen is handed.
          projectSwitcher: <UiProjectSwitcher />,
        },
        {
          hasPermission: (permission) => session.hasPermission(permission),
          succeeded: (notice) => feedback.succeeded(notice),
          failed: (failure) => feedback.failed(failure),
        },
      ),
    [activeScope.projectId, session, feedback],
  );

  return <SecretHostProvider value={host}>{children}</SecretHostProvider>;
}

/** Wraps the Secrets screen in the host its package asks for. */
export function withSecretHost<P extends object>(Screen: ComponentType<P>): ComponentType<P> {
  const Mounted = (props: P) => (
    <SecretHost>
      <Screen {...props} />
    </SecretHost>
  );
  Mounted.displayName = `withSecretHost(${Screen.displayName ?? Screen.name ?? "Screen"})`;
  return Mounted;
}

export { secretApi };
