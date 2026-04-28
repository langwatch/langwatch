import {
  Box,
  Heading,
  HStack,
  Icon,
  SimpleGrid,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { IconType } from "react-icons";
import {
  LuActivity,
  LuArrowUpDown,
  LuCircleHelp,
  LuEye,
  LuFilter,
  LuKeyboard,
  LuLayers,
  LuNavigation,
} from "react-icons/lu";
import { Kbd } from "~/components/ops/shared/Kbd";
import { Dialog } from "~/components/ui/dialog";

type GroupAccent = "blue" | "purple" | "teal" | "amber" | "pink" | "gray";

export interface ShortcutGroup {
  title: string;
  items: Array<{
    keys: string[];
    label: string;
    detail?: string;
  }>;
  icon?: IconType;
  accent?: GroupAccent;
}

interface KeyboardShortcutsHelpProps {
  open: boolean;
  onClose: () => void;
  /** Override the shortcut groups shown. Defaults to the trace drawer set. */
  groups?: ShortcutGroup[];
}

const TITLE_DEFAULTS: Record<string, { icon: IconType; accent: GroupAccent }> =
  {
    View: { icon: LuEye, accent: "blue" },
    Visualisation: { icon: LuLayers, accent: "purple" },
    Visualization: { icon: LuLayers, accent: "purple" },
    Navigation: { icon: LuNavigation, accent: "teal" },
    Actions: { icon: LuActivity, accent: "pink" },
    Help: { icon: LuCircleHelp, accent: "amber" },
    "Filter sidebar": { icon: LuFilter, accent: "pink" },
    "Reorder sections": { icon: LuArrowUpDown, accent: "gray" },
  };

const DRAWER_GROUPS: ShortcutGroup[] = [
  {
    title: "View",
    items: [
      { keys: ["T"], label: "Trace view" },
      { keys: ["L"], label: "LLM tab" },
      {
        keys: ["P"],
        label: "Prompts tab",
        detail: "When the trace used a managed prompt",
      },
      { keys: ["C"], label: "Conversation view" },
      { keys: ["M"], label: "Maximize / restore" },
      { keys: ["Esc"], label: "Close drawer / span" },
    ],
  },
  {
    title: "Visualisation",
    items: [
      { keys: ["1"], label: "Waterfall" },
      { keys: ["2"], label: "Flame graph" },
      { keys: ["3"], label: "Span list" },
      { keys: ["4"], label: "Sequence diagram" },
    ],
  },
  {
    title: "Navigation",
    items: [
      { keys: ["→", "J"], label: "Next trace in conversation" },
      { keys: ["←", "K"], label: "Previous trace in conversation" },
      { keys: ["]"], label: "Next span" },
      { keys: ["["], label: "Previous span" },
      { keys: ["O"], label: "Back to trace summary" },
      { keys: ["B"], label: "Back to previous trace" },
    ],
  },
  {
    title: "Actions",
    items: [
      { keys: ["R"], label: "Refresh trace" },
      { keys: ["Y"], label: "Copy trace ID" },
      { keys: ["\\"], label: "View raw JSON" },
    ],
  },
  {
    title: "Help",
    items: [{ keys: ["?"], label: "Show this help" }],
  },
];

function resolveGroupVisuals(group: ShortcutGroup) {
  const fallback = TITLE_DEFAULTS[group.title];
  return {
    icon: group.icon ?? fallback?.icon ?? LuKeyboard,
    accent: group.accent ?? fallback?.accent ?? "gray",
  };
}

export function KeyboardShortcutsHelp({
  open,
  onClose,
  groups = DRAWER_GROUPS,
}: KeyboardShortcutsHelpProps) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(e) => {
        if (!e.open) onClose();
      }}
      size="lg"
    >
      <Dialog.Content maxHeight="85vh" overflow="hidden">
        <Dialog.Header
          paddingX={5}
          paddingY={4}
          borderBottomWidth="1px"
          borderColor="border.muted"
          background="linear-gradient(135deg, var(--chakra-colors-blue-subtle), var(--chakra-colors-purple-subtle))"
        >
          <HStack gap={3} align="center">
            <Box
              bg="bg.panel"
              borderWidth="1px"
              borderColor="border.muted"
              rounded="md"
              padding={2}
              color="blue.fg"
              boxShadow="sm"
            >
              <Icon as={LuKeyboard} boxSize="18px" />
            </Box>
            <VStack align="start" gap={0}>
              <Heading textStyle="md" fontWeight="semibold" color="fg">
                Keyboard Shortcuts
              </Heading>
              <Text textStyle="xs" color="fg.muted">
                Press any key — watch it light up below.
              </Text>
            </VStack>
          </HStack>
          <Dialog.CloseTrigger />
        </Dialog.Header>
        <Dialog.Body paddingX={5} paddingY={4} overflow="auto" bg="bg.subtle">
          <SimpleGrid columns={{ base: 1, md: 2 }} gap={3}>
            {groups.map((group) => {
              const { icon, accent } = resolveGroupVisuals(group);
              return (
                <Box
                  key={group.title}
                  borderWidth="1px"
                  borderColor="border.muted"
                  rounded="md"
                  overflow="hidden"
                  bg="bg.panel"
                  transition="border-color 0.15s ease, box-shadow 0.15s ease"
                  _hover={{
                    borderColor: `${accent}.muted`,
                    boxShadow: "sm",
                  }}
                >
                  <HStack
                    paddingX={3}
                    paddingY={2}
                    bg={`${accent}.subtle`}
                    borderBottomWidth="1px"
                    borderColor="border.muted"
                    gap={2}
                  >
                    <Icon as={icon} boxSize="13px" color={`${accent}.fg`} />
                    <Text
                      textStyle="2xs"
                      color={`${accent}.fg`}
                      textTransform="uppercase"
                      letterSpacing="0.08em"
                      fontWeight="bold"
                    >
                      {group.title}
                    </Text>
                  </HStack>
                  <VStack align="stretch" gap={1.5} paddingX={3} paddingY={3}>
                    {group.items.map((item) => (
                      <HStack
                        key={`${item.label}-${item.keys.join("+")}`}
                        gap={3}
                        justify="space-between"
                        align="start"
                      >
                        <VStack align="start" gap={0} flex="1" minWidth={0}>
                          <Text textStyle="xs" color="fg" lineHeight="1.4">
                            {item.label}
                          </Text>
                          {item.detail ? (
                            <Text
                              textStyle="2xs"
                              color="fg.muted"
                              lineHeight="1.3"
                            >
                              {item.detail}
                            </Text>
                          ) : null}
                        </VStack>
                        <HStack gap={1} flexShrink={0} paddingTop="1px">
                          {item.keys.map((k, i) => (
                            <HStack key={`${k}-${i}`} gap={1}>
                              {i > 0 ? (
                                <Text
                                  textStyle="2xs"
                                  color="fg.subtle"
                                  fontWeight="medium"
                                >
                                  or
                                </Text>
                              ) : null}
                              <Kbd>{k}</Kbd>
                            </HStack>
                          ))}
                        </HStack>
                      </HStack>
                    ))}
                  </VStack>
                </Box>
              );
            })}
          </SimpleGrid>
        </Dialog.Body>
        <HStack
          paddingX={5}
          paddingY={2}
          borderTopWidth="1px"
          borderColor="border.muted"
          bg="bg.panel"
          justify="space-between"
        >
          <Text textStyle="2xs" color="fg.subtle">
            Shortcuts pause while you're typing in inputs.
          </Text>
          <HStack gap={1}>
            <Text textStyle="2xs" color="fg.subtle">
              Close
            </Text>
            <Kbd>Esc</Kbd>
          </HStack>
        </HStack>
      </Dialog.Content>
    </Dialog.Root>
  );
}
