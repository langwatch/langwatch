import {
  Box,
  HStack,
  Heading,
  Icon,
  Text,
  VStack,
} from "@chakra-ui/react";
import { LuKeyboard, LuX } from "react-icons/lu";
import { Kbd } from "~/components/ops/shared/Kbd";

export interface ShortcutGroup {
  title: string;
  items: Array<{
    keys: string[];
    label: string;
    detail?: string;
  }>;
}

interface KeyboardShortcutsHelpProps {
  open: boolean;
  onClose: () => void;
  /** Override the shortcut groups shown. Defaults to the trace drawer set. */
  groups?: ShortcutGroup[];
}

const DRAWER_GROUPS: ShortcutGroup[] = [
  {
    title: "View",
    items: [
      { keys: ["T"], label: "Trace view" },
      { keys: ["L"], label: "LLM tab" },
      { keys: ["P"], label: "Prompts tab", detail: "When the trace used a managed prompt" },
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
      { keys: ["4"], label: "Markdown" },
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
    title: "Help",
    items: [{ keys: ["?"], label: "Show this help" }],
  },
];

export function KeyboardShortcutsHelp({
  open,
  onClose,
  groups = DRAWER_GROUPS,
}: KeyboardShortcutsHelpProps) {
  if (!open) return null;

  return (
    <Box
      position="fixed"
      inset={0}
      zIndex={2000}
      bg="blackAlpha.600"
      onClick={onClose}
      css={{
        animation: "kbdHelpFade 0.12s ease-out",
        "@keyframes kbdHelpFade": {
          from: { opacity: 0 },
          to: { opacity: 1 },
        },
      }}
    >
      <Box
        position="absolute"
        top="50%"
        left="50%"
        transform="translate(-50%, -50%)"
        bg="bg.panel"
        borderRadius="md"
        borderWidth="1px"
        borderColor="border"
        width="480px"
        maxWidth="90vw"
        maxHeight="80vh"
        overflow="auto"
        boxShadow="lg"
        onClick={(e) => e.stopPropagation()}
      >
        <HStack
          paddingX={3}
          paddingY={2}
          borderBottomWidth="1px"
          borderColor="border.muted"
          justify="space-between"
        >
          <HStack gap={1.5}>
            <Icon as={LuKeyboard} boxSize="12px" color="fg.muted" />
            <Heading textStyle="xs" fontWeight="semibold">
              Keyboard Shortcuts
            </Heading>
          </HStack>
          <Box
            as="button"
            onClick={onClose}
            padding={0.5}
            borderRadius="sm"
            _hover={{ bg: "bg.muted" }}
            aria-label="Close shortcuts"
          >
            <Icon as={LuX} boxSize="12px" color="fg.subtle" />
          </Box>
        </HStack>
        <VStack align="stretch" gap={3} paddingX={3} paddingY={3}>
          {groups.map((group) => (
            <VStack key={group.title} align="stretch" gap={1}>
              <Text
                textStyle="2xs"
                color="fg.muted"
                textTransform="uppercase"
                letterSpacing="0.08em"
                fontWeight="semibold"
              >
                {group.title}
              </Text>
              <VStack align="stretch" gap={0.5}>
                {group.items.map((item) => (
                  <HStack key={item.label} gap={2} justify="space-between">
                    <Text textStyle="xs" color="fg">
                      {item.label}
                    </Text>
                    <HStack gap={1}>
                      {item.keys.map((k) => (
                        <Kbd key={k}>{k}</Kbd>
                      ))}
                    </HStack>
                  </HStack>
                ))}
              </VStack>
            </VStack>
          ))}
        </VStack>
        <Box
          paddingX={3}
          paddingY={1.5}
          borderTopWidth="1px"
          borderColor="border.muted"
          bg="bg.subtle"
        >
          <Text textStyle="2xs" color="fg.subtle">
            Shortcuts are disabled while typing in inputs.
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
