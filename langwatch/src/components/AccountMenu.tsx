import { Avatar, Box, Button, Portal, Text, VStack } from "@chakra-ui/react";
import {
  Activity,
  BookOpen,
  Bug,
  KeyRound,
  Lightbulb,
  LifeBuoy,
  LogOut,
  MessageCircle,
  Settings,
  User,
} from "lucide-react";
import React from "react";
import { LuGithub } from "react-icons/lu";

import { ImpersonationSwitchBackMenuItem } from "../../ee/admin/ImpersonationSwitchBackMenuItem";
import { useFeatureFlag } from "../hooks/useFeatureFlag";
import { useLiteMemberGuard } from "../hooks/useLiteMemberGuard";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";
import { usePublicEnv } from "../hooks/usePublicEnv";
import { useRequiredSession } from "../hooks/useRequiredSession";
import { DiscordOutlineIcon } from "./icons/DiscordOutline";
import { PresenceMenuItem } from "./sidebar/PresenceMenuItem";
import { Link } from "./ui/link";
import { Menu } from "./ui/menu";
import { ThemeSwitch } from "./ui/theme-switch";

const MENU_ICON_SIZE = 14;

export type AccountMenuProps = {
  publicPage?: boolean;
  showPresenceMenuItem?: boolean;
};

/**
 * The avatar menu in the header's top-right: the one hub for everything
 * about the signed-in person — account destinations (My Workspace, API
 * Keys, Settings), help (documentation, support channels, live chat),
 * appearance, and sign out. The sidebar deliberately carries none of
 * these anymore.
 *
 * Spec: specs/navigation/account-menu-hub.feature
 */
export const AccountMenu = React.memo(function AccountMenu({
  publicPage = false,
  showPresenceMenuItem = false,
}: AccountMenuProps) {
  const { data: session } = useRequiredSession({ required: !publicPage });
  const { isLiteMember } = useLiteMemberGuard();
  const { organization } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  const publicEnv = usePublicEnv();
  // The "My Workspace" entry is part of the governance preview surface. The
  // flag is org-targeted, so it must resolve on the org id — gating on
  // project would diverge from the /me pages (which key off the org) and
  // show the menu entry while the page it links to 404s.
  const { enabled: governancePreviewEnabled } = useFeatureFlag(
    "release_ui_ai_governance_enabled",
    { organizationId: organization?.id, enabled: !!organization?.id },
  );

  const user = session?.user;

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
          aria-label="Account"
          {...(publicPage
            ? {
                // On a public share page, clicking the avatar offers
                // sign-in. Route to the signin page with the current
                // URL as callbackUrl so the UI picks the right provider
                // from `publicEnv.NEXTAUTH_PROVIDER`.
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
          <Avatar.Root
            size="xs"
            backgroundColor="orange.400"
            color="white"
            width="28px"
            height="28px"
          >
            <Avatar.Fallback name={user?.name ?? undefined} fontSize="11px" />
          </Avatar.Root>
        </Button>
      </Menu.Trigger>
      {session && (
        <Portal>
          <Menu.Content minWidth="240px">
            <ImpersonationSwitchBackMenuItem />

            <Box paddingX={3} paddingTop={2} paddingBottom={2.5}>
              <VStack gap={0} align="start">
                <Text fontSize="sm" fontWeight="medium" lineClamp={1}>
                  {session.user.name}
                </Text>
                <Text fontSize="xs" color="fg.muted" lineClamp={1}>
                  {session.user.email}
                </Text>
              </VStack>
            </Box>
            <Menu.Separator />

            {governancePreviewEnabled && (
              <Menu.Item value="my-workspace" asChild>
                <Link href="/me">
                  <User size={MENU_ICON_SIZE} /> My Workspace
                </Link>
              </Menu.Item>
            )}
            {!isLiteMember && (
              <Menu.Item value="api-keys" asChild>
                <Link href="/settings/api-keys">
                  <KeyRound size={MENU_ICON_SIZE} /> API Keys
                </Link>
              </Menu.Item>
            )}
            <Menu.Item value="settings" asChild>
              <Link href="/settings">
                <Settings size={MENU_ICON_SIZE} /> Settings
              </Link>
            </Menu.Item>
            {showPresenceMenuItem && <PresenceMenuItem />}

            <Menu.Separator />

            <Menu.Item value="documentation" asChild>
              <Link isExternal href="https://docs.langwatch.ai">
                <BookOpen size={MENU_ICON_SIZE} /> Documentation
              </Link>
            </Menu.Item>
            <Menu.Root positioning={{ placement: "right-start", gutter: 2 }}>
              <Menu.TriggerItem
                startIcon={<LifeBuoy size={MENU_ICON_SIZE} />}
              >
                Support
              </Menu.TriggerItem>
              <Portal>
                <Menu.Content minWidth="200px">
                  <Menu.Item value="github-support" asChild>
                    <Link
                      isExternal
                      href="https://github.com/orgs/langwatch/discussions/categories/support"
                    >
                      <LuGithub size={MENU_ICON_SIZE} /> GitHub Support
                    </Link>
                  </Menu.Item>
                  <Menu.Item value="discord" asChild>
                    <Link isExternal href="https://discord.gg/kT4PhDS2gH">
                      <DiscordOutlineIcon /> Discord
                    </Link>
                  </Menu.Item>
                  <Menu.Item value="status" asChild>
                    <Link isExternal href="https://status.langwatch.ai/">
                      <Activity size={MENU_ICON_SIZE} /> Status Page
                    </Link>
                  </Menu.Item>
                  <Menu.Separator />
                  <Menu.Item value="feature-requests" asChild>
                    <Link
                      isExternal
                      href="https://github.com/orgs/langwatch/discussions/categories/ideas"
                    >
                      <Lightbulb size={MENU_ICON_SIZE} /> Feature Request
                    </Link>
                  </Menu.Item>
                  <Menu.Item value="bug-reports" asChild>
                    <Link
                      isExternal
                      href="https://github.com/langwatch/langwatch/issues"
                    >
                      <Bug size={MENU_ICON_SIZE} /> Report a Bug
                    </Link>
                  </Menu.Item>
                </Menu.Content>
              </Portal>
            </Menu.Root>
            {publicEnv.data?.IS_SAAS && (
              <Menu.Item
                value="chat"
                onClick={() => {
                  const crisp = (
                    window as unknown as {
                      $crisp?: { push: (args: unknown[]) => void };
                    }
                  ).$crisp;
                  crisp?.push(["do", "chat:show"]);
                  crisp?.push(["do", "chat:toggle"]);
                }}
              >
                <MessageCircle size={MENU_ICON_SIZE} /> Chat with us
              </Menu.Item>
            )}

            <Menu.Separator />

            <Box paddingX={3} paddingY={1.5}>
              <Box
                display="flex"
                alignItems="center"
                justifyContent="space-between"
                gap={3}
              >
                <Text fontSize="sm" color="fg.muted">
                  Theme
                </Text>
                <ThemeSwitch />
              </Box>
            </Box>

            <Menu.Separator />

            <Menu.Item value="logout" asChild>
              <a href="/api/auth/logout">
                <LogOut size={MENU_ICON_SIZE} /> Log out
              </a>
            </Menu.Item>
          </Menu.Content>
        </Portal>
      )}
    </Menu.Root>
  );
});
