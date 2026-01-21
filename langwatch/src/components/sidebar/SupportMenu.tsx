import { Box, MenuSeparator, Portal, VStack } from "@chakra-ui/react";
import { useState } from "react";
import {
  LuActivity,
  LuBookOpen,
  LuBug,
  LuChevronRight,
  LuGithub,
  LuLifeBuoy,
  LuLightbulb,
  LuMap,
  LuMessageCircle,
} from "react-icons/lu";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import { DiscordOutlineIcon } from "../icons/DiscordOutline";
import { useColorRawValue } from "../ui/color-mode";
import { Link } from "../ui/link";
import { Menu } from "../ui/menu";
import { SideMenuItem } from "./SideMenuLink";
import { useHomeTour } from "../home/coachmarks/HomeTourContext";

export type SupportMenuProps = {
  showLabel?: boolean;
};

export const SupportMenu = ({ showLabel = true }: SupportMenuProps) => {
  const gray600 = useColorRawValue("gray.600");
  const [isOpen, setIsOpen] = useState(false);
  const publicEnv = usePublicEnv();
  const homeTour = useHomeTour();

  return (
    <VStack width="full" align="start" gap={0.5}>
      {/* Chat button */}
      {publicEnv.data?.IS_SAAS && (
        <Box
          as="button"
          width="full"
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
            width="full"
            cursor="pointer"
            aria-label="Support"
            onMouseEnter={() => setIsOpen(true)}
          >
            <SideMenuItem
              icon={LuLifeBuoy}
              label="Support"
              isActive={isOpen}
              showLabel={showLabel}
              rightElement={
                showLabel ? (
                  <LuChevronRight size={14} color={gray600} />
                ) : undefined
              }
            />
          </Box>
        </Menu.Trigger>

        <Portal>
          <Menu.Content marginLeft={-1} onMouseLeave={() => setIsOpen(false)}>
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
            {homeTour && (
              <Menu.Item value="home-tour">
                <Box
                  as="button"
                  width="full"
                  onClick={() => {
                    setIsOpen(false);
                    homeTour.startTour();
                  }}
                >
                  <LuMap /> Take Home Tour
                </Box>
              </Menu.Item>
            )}
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
