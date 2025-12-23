import { Box, HStack, MenuSeparator, Portal, Spacer, Text, VStack } from "@chakra-ui/react";
import {
  Activity,
  Bug,
  BookOpen,
  ChevronRight,
  Github,
  LifeBuoy,
  Lightbulb,
  MessageCircle,
} from "lucide-react";
import { useState } from "react";
import { DiscordOutlineIcon } from "../icons/DiscordOutline";
import { useColorRawValue } from "../ui/color-mode";
import { Link } from "../ui/link";
import { Menu } from "../ui/menu";
import { Tooltip } from "../ui/tooltip";

const MENU_ITEM_HEIGHT = "32px";
const ICON_SIZE = 16;

export type SupportMenuProps = {
  showLabel?: boolean;
};

export const SupportMenu = ({ showLabel = true }: SupportMenuProps) => {
  const gray600 = useColorRawValue("gray.600");
  const [isOpen, setIsOpen] = useState(false);

  return (
    <VStack width="full" align="start" gap={0.5}>
      {/* Chat button */}
      <Tooltip
        content="Chat"
        positioning={{ placement: "right" }}
        disabled={showLabel}
        openDelay={0}
      >
        <HStack
          as="button"
          width="full"
          height={MENU_ITEM_HEIGHT}
          gap={3}
          paddingX={3}
          borderRadius="lg"
          backgroundColor="transparent"
          _hover={{
            backgroundColor: "gray.200",
          }}
          transition="background-color 0.15s ease-in-out"
          cursor="pointer"
          aria-label="Chat"
          onClick={(e) => {
            e.preventDefault();
            (window as unknown as { $crisp?: { push: (args: unknown[]) => void } }).$crisp?.push([
              "do",
              "chat:show",
            ]);
            (window as unknown as { $crisp?: { push: (args: unknown[]) => void } }).$crisp?.push([
              "do",
              "chat:toggle",
            ]);
          }}
        >
          <Box
            flexShrink={0}
            display="flex"
            alignItems="center"
            justifyContent="center"
            width={`${ICON_SIZE}px`}
            height={`${ICON_SIZE}px`}
          >
            <MessageCircle size={ICON_SIZE} color={gray600} />
          </Box>
          {showLabel && (
            <Text fontSize="14px" fontWeight="normal" color="gray.700" whiteSpace="nowrap">
              Chat
            </Text>
          )}
        </HStack>
      </Tooltip>

      {/* Support menu */}
      <Menu.Root
        positioning={{ placement: "right-start" }}
        open={isOpen}
        onOpenChange={({ open }) => setIsOpen(open)}
      >
        <Tooltip
          content="Support"
          positioning={{ placement: "right" }}
          disabled={showLabel || isOpen}
          openDelay={0}
        >
          <Menu.Trigger asChild>
            <HStack
              as="button"
              width="full"
              height={MENU_ITEM_HEIGHT}
              gap={3}
              paddingX={3}
              borderRadius="lg"
              backgroundColor={isOpen ? "gray.200" : "transparent"}
              _hover={{
                backgroundColor: "gray.200",
              }}
              transition="background-color 0.15s ease-in-out"
              cursor="pointer"
              aria-label="Support"
              onMouseEnter={() => setIsOpen(true)}
            >
              <Box
                flexShrink={0}
                display="flex"
                alignItems="center"
                justifyContent="center"
                width={`${ICON_SIZE}px`}
                height={`${ICON_SIZE}px`}
              >
                <LifeBuoy size={ICON_SIZE} color={gray600} />
              </Box>
              {showLabel && (
                <>
                  <Text fontSize="14px" fontWeight="normal" color="gray.700" whiteSpace="nowrap">
                    Support
                  </Text>
                  <Spacer />
                  <ChevronRight size={14} color={gray600} />
                </>
              )}
            </HStack>
          </Menu.Trigger>
        </Tooltip>

        <Portal>
          <Menu.Content marginLeft={-1} onMouseLeave={() => setIsOpen(false)}>
            <Menu.Item value="github">
              <Link
                isExternal
                href="https://github.com/orgs/langwatch/discussions/categories/support"
              >
                <Github /> GitHub Support
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
                <BookOpen /> Documentation
              </Link>
            </Menu.Item>

            <Menu.Item value="status">
              <Link isExternal href="https://status.langwatch.ai/">
                <Activity /> Status Page
              </Link>
            </Menu.Item>

            <MenuSeparator />

            <Menu.Item value="feature-requests">
              <Link
                isExternal
                href="https://github.com/orgs/langwatch/discussions/categories/ideas"
              >
                <Lightbulb /> Feature Request
              </Link>
            </Menu.Item>
            <Menu.Item value="bug-reports">
              <Link
                isExternal
                href="https://github.com/langwatch/langwatch/issues"
              >
                <Bug /> Report a Bug
              </Link>
            </Menu.Item>
          </Menu.Content>
        </Portal>
      </Menu.Root>
    </VStack>
  );
};
