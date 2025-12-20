import { HStack, MenuSeparator, Portal, Text, VStack } from "@chakra-ui/react";
import {
  Activity,
  Bug,
  BookOpen,
  Github,
  LifeBuoy,
  Lightbulb,
  MessageCircle,
} from "lucide-react";
import { DiscordOutlineIcon } from "../icons/DiscordOutline";
import { Link } from "../ui/link";
import { Menu } from "../ui/menu";

const MENU_ITEM_HEIGHT = "32px";
const ICON_SIZE = 16;

export type SupportMenuProps = {
  showLabel?: boolean;
};

export const SupportMenu = ({ showLabel = true }: SupportMenuProps) => {
  return (
    <VStack width="full" align="start" gap={0} paddingBottom={4}>
      <HStack
        as="button"
        width="full"
        height={MENU_ITEM_HEIGHT}
        align="center"
        gap={3}
        cursor="pointer"
        paddingX={3}
        borderRadius="lg"
        _hover={{
          backgroundColor: "gray.200",
        }}
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
        <MessageCircle size={ICON_SIZE} />
        {showLabel && (
          <Text fontSize="14px" color="gray.700">
            Chat
          </Text>
        )}
      </HStack>

      <Menu.Root positioning={{ placement: "right-start" }}>
        <Menu.Trigger asChild>
          <HStack
            as="button"
            width="full"
            height={MENU_ITEM_HEIGHT}
            align="center"
            gap={3}
            cursor="pointer"
            paddingX={3}
            borderRadius="lg"
            _hover={{
              backgroundColor: "gray.200",
            }}
            aria-label="Support"
          >
            <LifeBuoy size={ICON_SIZE} />
            {showLabel && (
              <Text fontSize="14px" color="gray.700">
                Support
              </Text>
            )}
          </HStack>
        </Menu.Trigger>

        <Portal>
          <Menu.Content>
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

