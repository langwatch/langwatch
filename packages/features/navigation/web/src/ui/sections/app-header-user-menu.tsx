/**
 * The avatar button and its dropdown, top-right of the shell's header.
 *
 * Moved from `platform/app/src/components/AppHeaderUserMenu.tsx`. It keeps its
 * account entries, the navigation-mode picker and the reduced-graphics control;
 * three things travelled differently and all three are recorded:
 *
 * - LOGOUT IS AN ACTION, NOT A LINK. It was `<a href="/api/auth/logout">`,
 *   which named an address of the application that served it. The host ends
 *   the session instead, through the ONE identity client the application owns —
 *   a governed web package may not import an authentication implementation at
 *   all (`frontend-ui-boundaries` names `better-auth` by name).
 * - The experiments dialog and the impersonation switch-back entry are
 *   `@langwatch/feature-flag-web` and `platform/app`'s ops components. Both are
 *   handed in by the host as nodes, the shape `waiting()` established, so this
 *   package takes no dependency on either half.
 * - The presence toggle did not travel. It reads a presence store and a
 *   platform-only feature hook, it was mounted on one lens, and the
 *   application that mounted it is the half being deleted.
 *
 * Spec: specs/navigation/navigation-modes.feature
 */

import { Box, Button, HStack, Portal } from "@chakra-ui/react";
import { Menu } from "@langwatch/design-system/menu";
import { Monitor, PanelsTopLeft } from "lucide-react";
import {
  DEFAULT_NAVIGATION_MODE,
  type NavigationMode,
  useNavigationModeStore,
} from "../../behavior/navigation-mode.store";
import { useNavigationHost } from "../../model/navigation-host";
import { NavigationLink } from "../elements/navigation-link";
import { UserAvatar } from "../elements/user-avatar";

const NAVIGATION_MODE_LABELS: Record<NavigationMode, string> = {
  "product-switcher": "Product switcher",
  "icon-rail": "Icon rail",
};

const NAVIGATION_MODES = Object.keys(NAVIGATION_MODE_LABELS) as NavigationMode[];

export function AppHeaderUserMenu() {
  const host = useNavigationHost();
  const user = host.currentUser();
  const plan = host.plan();
  const accountMenu = host.accountMenu();

  // The "My Workspace" entry is part of the governance preview surface,
  // distinct from the AI Gateway menu, which keeps shipping under its own
  // flag. The flag is organization-targeted, and the landing destination is
  // decided at the organization, so the entry and the page it opens agree.
  const governancePreviewEnabled = host.featureFlag("release_ui_ai_governance_enabled").enabled;

  // The navigation-mode preference lives on the device (see
  // navigation-mode.store).
  const storedNavigationMode = useNavigationModeStore((s) => s.storedMode);
  const setStoredNavigationMode = useNavigationModeStore((s) => s.setStoredMode);
  // A device that never picked runs the default mode; the picker reports that,
  // not an empty choice.
  const currentNavigationMode = storedNavigationMode ?? DEFAULT_NAVIGATION_MODE;

  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button
          variant="ghost"
          size="xs"
          padding={0}
          minWidth="auto"
          height="auto"
          borderRadius="full"
          aria-label={user?.name ? `Open user menu for ${user.name}` : "Open user menu"}
        >
          <UserAvatar
            name={user?.name ?? void 0}
            image={user?.image ?? void 0}
            size="xs"
            backgroundColor="orange.400"
            color="white"
            width="28px"
            height="28px"
          />
        </Button>
      </Menu.Trigger>
      {user && (
        <Portal>
          <Menu.Content>
            {accountMenu?.leading}
            <Menu.ItemGroup title={`${user.name ?? ""} (${user.email ?? ""})`}>
              {governancePreviewEnabled && (
                <Menu.Item value="my-workspace" asChild>
                  <NavigationLink href="/me">My Workspace</NavigationLink>
                </Menu.Item>
              )}
              {!plan.isLiteMember && (
                <Menu.Item value="api-keys" asChild>
                  <NavigationLink href="/settings/api-keys">API Keys</NavigationLink>
                </Menu.Item>
              )}
              <Menu.Item value="settings" asChild>
                <NavigationLink href="/settings">Settings</NavigationLink>
              </Menu.Item>
              {accountMenu?.experiments && (
                <Menu.Item value="experiments" onSelect={accountMenu.experiments.open}>
                  <HStack gap={2}>
                    <span>Experiments</span>
                    {accountMenu.experiments.hasUnseen && (
                      <Box
                        aria-label="New experiments available"
                        role="status"
                        width="6px"
                        height="6px"
                        borderRadius="full"
                        backgroundColor="blue.solid"
                      />
                    )}
                  </HStack>
                </Menu.Item>
              )}
              <Menu.Root positioning={{ placement: "right-start", gutter: 2 }}>
                <Menu.TriggerItem value="navigation-mode">
                  <PanelsTopLeft size={14} />
                  Navigation ({NAVIGATION_MODE_LABELS[currentNavigationMode]})
                </Menu.TriggerItem>
                <Menu.Content>
                  <Menu.RadioItemGroup
                    value={currentNavigationMode}
                    onValueChange={(e) => setStoredNavigationMode(e.value as NavigationMode)}
                  >
                    {NAVIGATION_MODES.map((mode) => (
                      <Menu.RadioItem key={mode} value={mode}>
                        {NAVIGATION_MODE_LABELS[mode]}
                      </Menu.RadioItem>
                    ))}
                  </Menu.RadioItemGroup>
                </Menu.Content>
              </Menu.Root>
              {accountMenu?.graphicsQuality && (
                <Menu.Root positioning={{ placement: "right-start", gutter: 2 }}>
                  <Menu.TriggerItem value="reduced-graphics">
                    <Monitor size={14} />
                    Reduced graphics ({accountMenu.graphicsQuality.label})
                  </Menu.TriggerItem>
                  <Menu.Content>
                    <Menu.RadioItemGroup
                      value={accountMenu.graphicsQuality.value}
                      onValueChange={(e) => accountMenu.graphicsQuality?.set(e.value)}
                    >
                      <Menu.RadioItem value="auto">
                        Auto — adapts to this device on its own
                      </Menu.RadioItem>
                      <Menu.RadioItem value="on">On — always keep things responsive</Menu.RadioItem>
                      <Menu.RadioItem value="off">
                        Off — always show full decorative effects
                      </Menu.RadioItem>
                    </Menu.RadioItemGroup>
                  </Menu.Content>
                </Menu.Root>
              )}
              {accountMenu?.trailing}
              <Menu.Item value="logout" onSelect={() => host.signOut()}>
                Logout
              </Menu.Item>
            </Menu.ItemGroup>
          </Menu.Content>
        </Portal>
      )}
      {accountMenu?.dialogs}
    </Menu.Root>
  );
}
