/**
 * `useDrawer`, narrowed to the ADDRESS.
 *
 * The organization screens open four of the application's overlays —
 * `inviteMember`, `createTeam`, `createProject` and `editProject` — and close
 * whichever is open. None of them is this package's to render, so what travels
 * is the address and not the registry: the traces family's ruling, applied to a
 * family that opens only other people's overlays.
 *
 * Named after the hook it replaces so the call sites keep reading
 * `openDrawer("createProject", { defaultTeamId })`.
 */

import { useMemo } from "react";
import { useOrganizationHost } from "../model/organization-host";

export type OrganizationDrawerNavigator = {
  openDrawer: (name: string, props?: Record<string, unknown>) => void;
  closeDrawer: () => void;
};

export function useDrawer(): OrganizationDrawerNavigator {
  const host = useOrganizationHost();
  return useMemo(
    () => ({
      openDrawer: (name, props) => host.openOverlay(name, props),
      closeDrawer: () => host.closeOverlay(),
    }),
    [host],
  );
}
