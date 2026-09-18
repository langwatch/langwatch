import { Button, Portal } from "@chakra-ui/react";
import { Monitor, PanelsTopLeft } from "lucide-react";
import {
  DEFAULT_NAVIGATION_MODE,
  type NavigationMode,
  useNavigationModeStore,
} from "~/features/navigation/navigationModeStore";
import { ImpersonationSwitchBackMenuItem } from "../../ee/admin/ImpersonationSwitchBackMenuItem";
import { useFeatureFlag } from "../hooks/useFeatureFlag";
import { useLiteMemberGuard } from "../hooks/useLiteMemberGuard";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";
import { useRequiredSession } from "../hooks/useRequiredSession";
import {
  type GraphicsQualityOverride,
  useGraphicsQualityOverrideStore,
} from "../stores/graphicsQualityOverrideStore";
import { trackEvent } from "../utils/tracking";
import { PresenceMenuItem } from "./sidebar/PresenceMenuItem";
import { UserAvatar } from "./UserAvatar";
import { Link } from "./ui/link";
import { Menu } from "./ui/menu";

const GRAPHICS_OVERRIDE_LABELS: Record<GraphicsQualityOverride, string> = {
  auto: "Auto",
  on: "On",
  off: "Off",
};

const NAVIGATION_MODE_LABELS: Record<NavigationMode, string> = {
  legacy: "Old navigation",
  "product-switcher": "Product switcher",
  "icon-rail": "Icon rail",
};

/** The order the modes are offered in, oldest first. */
const NAVIGATION_MODES = Object.keys(
  NAVIGATION_MODE_LABELS,
) as NavigationMode[];

/**
 * The avatar button and its dropdown in the top-right of the app header.
 * Shared by the legacy chrome and the navigation-v2 shells so the account
 * entries, the graphics override and the navigation-mode picker stay
 * identical in every mode. Self-contained: it resolves its own session,
 * flags and stores so a shell only decides where the avatar sits.
 *
 * Spec: specs/navigation/navigation-modes.feature
 */
export function AppHeaderUserMenu({
  publicPage = false,
  showPresenceMenuItem = false,
}: {
  publicPage?: boolean;
  showPresenceMenuItem?: boolean;
}) {
  const { data: session } = useRequiredSession({ required: !publicPage });
  const user = session?.user;
  const { organization, isLoading: isOrganizationLoading } =
    useOrganizationTeamProject({
      redirectToOnboarding: false,
      redirectToProjectOnboarding: false,
    });
  const { isLiteMember } = useLiteMemberGuard();

  // The "My Workspace" entry in the user-avatar dropdown is part of the
  // governance preview surface, distinct from the existing AI Gateway
  // menu (which keeps shipping unblocked under release_ui_ai_gateway_menu_enabled).
  // The flag is org-targeted, so it must resolve on the org id - gating on
  // project would diverge from the /me pages (which key off the org) and
  // show the menu entry while the page it links to 404s.
  const { enabled: governancePreviewEnabled } = useFeatureFlag(
    "release_ui_ai_governance_enabled",
    { organizationId: organization?.id, enabled: !!organization?.id },
  );

  // The navigation-mode picker only appears once the v2 flag is on; the
  // preference itself lives on the device (see navigationModeStore). The
  // gate matches useNavigationMode, which resolves the flag at user level
  // for a user with no organization: that persona reaches the new shells
  // on /me, so it must also reach the control that selects them.
  const { enabled: navigationV2Enabled } = useFeatureFlag(
    "release_ui_navigation_v2_enabled",
    {
      organizationId: organization?.id,
      enabled: !isOrganizationLoading,
    },
  );
  const storedNavigationMode = useNavigationModeStore((s) => s.storedMode);
  const setStoredNavigationMode = useNavigationModeStore(
    (s) => s.setStoredMode,
  );
  // The picker only shows with the flag on, where a device that never
  // picked runs the default mode. It reports that, not the old chrome.
  const currentNavigationMode = storedNavigationMode ?? DEFAULT_NAVIGATION_MODE;

  const graphicsQualityOverride = useGraphicsQualityOverrideStore(
    (s) => s.override,
  );
  const setGraphicsQualityOverride = useGraphicsQualityOverrideStore(
    (s) => s.setOverride,
  );

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
          aria-label={
            publicPage
              ? "Sign in"
              : user?.name
                ? `Open user menu for ${user.name}`
                : "Open user menu"
          }
          {...(publicPage
            ? {
                // On a public share page, clicking the avatar offers
                // sign-in. Route to the signin page with the current
                // URL as callbackUrl so the UI picks the right provider
                // from `publicEnv.NEXTAUTH_PROVIDER`. The old version
                // hardcoded `signIn("auth0")` which broke for on-prem
                // (email mode), google, gitlab, etc.
                onClick: () => {
                  if (typeof window !== "undefined") {
                    const callbackUrl = encodeURIComponent(
                      window.location.pathname + window.location.search,
                    );
                    window.location.href = `/auth/signin?callbackUrl=${callbackUrl}`;
                  }
                },
              }
            : {})}
        >
          <UserAvatar
            name={user?.name ?? undefined}
            image={user?.image ?? undefined}
            size="xs"
            backgroundColor="orange.400"
            color="white"
            width="28px"
            height="28px"
          />
        </Button>
      </Menu.Trigger>
      {session && (
        <Portal>
          <Menu.Content>
            <ImpersonationSwitchBackMenuItem />
            <Menu.ItemGroup
              title={`${session.user.name} (${session.user.email})`}
            >
              {governancePreviewEnabled && (
                <Menu.Item value="my-workspace" asChild>
                  <Link href="/me">My Workspace</Link>
                </Menu.Item>
              )}
              {!isLiteMember && (
                <Menu.Item value="api-keys" asChild>
                  <Link href="/settings/api-keys">API Keys</Link>
                </Menu.Item>
              )}
              <Menu.Item value="settings" asChild>
                <Link href="/settings">Settings</Link>
              </Menu.Item>
              {navigationV2Enabled && (
                <Menu.Root
                  positioning={{ placement: "right-start", gutter: 2 }}
                >
                  <Menu.TriggerItem value="navigation-mode">
                    <PanelsTopLeft size={14} />
                    Navigation ({NAVIGATION_MODE_LABELS[currentNavigationMode]})
                  </Menu.TriggerItem>
                  <Menu.Content>
                    <Menu.RadioItemGroup
                      value={currentNavigationMode}
                      onValueChange={(e) => {
                        const mode = e.value as NavigationMode;
                        setStoredNavigationMode(mode);
                        trackEvent("navigation_mode_change", { mode });
                      }}
                    >
                      {NAVIGATION_MODES.map((mode) => (
                        <Menu.RadioItem key={mode} value={mode}>
                          {NAVIGATION_MODE_LABELS[mode]}
                        </Menu.RadioItem>
                      ))}
                    </Menu.RadioItemGroup>
                  </Menu.Content>
                </Menu.Root>
              )}
              <Menu.Root positioning={{ placement: "right-start", gutter: 2 }}>
                <Menu.TriggerItem value="reduced-graphics">
                  <Monitor size={14} />
                  Reduced graphics (
                  {GRAPHICS_OVERRIDE_LABELS[graphicsQualityOverride]})
                </Menu.TriggerItem>
                <Menu.Content>
                  <Menu.RadioItemGroup
                    value={graphicsQualityOverride}
                    onValueChange={(e) =>
                      setGraphicsQualityOverride(
                        e.value as GraphicsQualityOverride,
                      )
                    }
                  >
                    <Menu.RadioItem value="auto">
                      Auto — adapts to this device on its own
                    </Menu.RadioItem>
                    <Menu.RadioItem value="on">
                      On — always keep things responsive
                    </Menu.RadioItem>
                    <Menu.RadioItem value="off">
                      Off — always show full decorative effects
                    </Menu.RadioItem>
                  </Menu.RadioItemGroup>
                </Menu.Content>
              </Menu.Root>
              {showPresenceMenuItem && <PresenceMenuItem />}
              <Menu.Item value="logout" asChild>
                <a href="/api/auth/logout">Logout</a>
              </Menu.Item>
            </Menu.ItemGroup>
          </Menu.Content>
        </Portal>
      )}
    </Menu.Root>
  );
}
