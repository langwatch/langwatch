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
 *
 * THE GRANT THIS KEY DOES NOT CARRY. The platform page was `SettingsLayout` and
 * nothing else, and read `secrets:manage` INLINE to decide whether the write
 * controls are live. A reader holding only `secrets:view` still sees which
 * secrets exist, which is what someone debugging a code block needs. Inventing
 * a page-level grant here would refuse them a page the product admits today.
 */

import { SecretHostProvider, secretApi, type SecretHostPort } from "@langwatch/secret-web/screens/secret";
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
