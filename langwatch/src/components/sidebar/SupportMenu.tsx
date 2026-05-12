import { Box, MenuSeparator, Portal, VStack } from "@chakra-ui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  LuActivity,
  LuBookOpen,
  LuBug,
  LuChevronRight,
  LuGithub,
  LuLifeBuoy,
  LuLightbulb,
  LuMessageCircle,
} from "react-icons/lu";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import { DiscordOutlineIcon } from "../icons/DiscordOutline";
import { Link } from "../ui/link";
import { Menu } from "../ui/menu";
import { SideMenuItem } from "./SideMenuLink";

export type SupportMenuProps = {
  showLabel?: boolean;
};

export const SupportMenu = ({ showLabel = true }: SupportMenuProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const publicEnv = usePublicEnv();

  // Hover-open menus need a short close delay so a mouse moving
  // diagonally from the trigger over to the content doesn't dismiss
  // the menu while crossing the 1px gap. Without this, sliding the
  // cursor past the trigger to a sidebar item below leaves the menu
  // stuck open with no cursor over it.
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);
  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimerRef.current = setTimeout(() => setIsOpen(false), 120);
  }, [cancelClose]);
  useEffect(() => cancelClose, [cancelClose]);

  return (
    <VStack width="full" align="start" gap={0.5}>
      {/* Chat button */}
      {publicEnv.data?.IS_SAAS && (
        <Box
          as="button"
          width={showLabel ? "full" : "auto"}
          textAlign="left"
          cursor="pointer"
          aria-label="Chat"
          onClick={(e) => {
            e.preventDefault();
            (
              window as unknown as {
                $crisp?: { push: (args: unknown[]) => void };
              }
            ).$crisp?.push(["do", "chat:show"]);
            (
              window as unknown as {
                $crisp?: { push: (args: unknown[]) => void };
              }
            ).$crisp?.push(["do", "chat:toggle"]);
          }}
        >
          <SideMenuItem
            icon={LuMessageCircle}
            label="Chat"
            showLabel={showLabel}
          />
        </Box>
      )}

      {/* Support menu */}
      <Menu.Root
        positioning={{ placement: "right-start" }}
        open={isOpen}
        onOpenChange={({ open }) => setIsOpen(open)}
      >
        <Menu.Trigger asChild>
          <Box
            as="button"
            width={showLabel ? "full" : "auto"}
            textAlign="left"
            cursor="pointer"
            aria-label="Support"
            onMouseEnter={() => {
              cancelClose();
              setIsOpen(true);
            }}
            onMouseLeave={scheduleClose}
          >
            <SideMenuItem
              icon={LuLifeBuoy}
              label="Support"
              isActive={isOpen}
              showLabel={showLabel}
              rightElement={
                showLabel ? (
                  <LuChevronRight
                    size={14}
                    color="var(--chakra-colors-nav-fg-muted)"
                  />
                ) : undefined
              }
            />
          </Box>
        </Menu.Trigger>

        <Portal>
          <Menu.Content
            marginLeft={-1}
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
          >
            <Menu.Item value="github">
              <Link
                isExternal
                href="https://github.com/orgs/langwatch/discussions/categories/support"
              >
                <LuGithub /> GitHub Support
              </Link>
            </Menu.Item>
            <Menu.Item value="discord">
              <Link isExternal href="https://discord.gg/kT4PhDS2gH">
                <DiscordOutlineIcon /> Discord
              </Link>
            </Menu.Item>
            <MenuSeparator />
            <Menu.Item value="documentation">
              <Link isExternal href="https://docs.langwatch.ai">
                <LuBookOpen /> Documentation
              </Link>
            </Menu.Item>

            <Menu.Item value="status">
              <Link isExternal href="https://status.langwatch.ai/">
                <LuActivity /> Status Page
              </Link>
            </Menu.Item>

            <MenuSeparator />

            <Menu.Item value="feature-requests">
              <Link
                isExternal
                href="https://github.com/orgs/langwatch/discussions/categories/ideas"
              >
                <LuLightbulb /> Feature Request
              </Link>
            </Menu.Item>
            <Menu.Item value="bug-reports">
              <Link
                isExternal
                href="https://github.com/langwatch/langwatch/issues"
              >
                <LuBug /> Report a Bug
              </Link>
            </Menu.Item>
          </Menu.Content>
        </Portal>
      </Menu.Root>
    </VStack>
  );
};
