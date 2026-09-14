/**
 * Actions menu for the personal usage header (hand to agent, copy prompt, read guide).
 */

import { Box, Button, chakra, HStack, Text } from "@chakra-ui/react";
import { Menu } from "@langwatch/design-system/menu";
import { LuBookOpen, LuChevronDown, LuSparkles, LuTerminal } from "react-icons/lu";

import { usePersonalToaster } from "../../behavior/personal-workspace-feedback.ts";

/** The icon + label + hint row every agent-menu entry renders. */
function AgentMenuOption({
  icon: Icon,
  label,
  hint,
}: {
  icon: typeof LuSparkles;
  label: string;
  hint: string;
}) {
  return (
    <HStack gap={2.5} width="full" align="start">
      <Box color="fg.subtle" display="grid" paddingTop="2px">
        <Icon size={13} />
      </Box>
      <Box minWidth={0} flex={1}>
        <Text textStyle="xs" fontWeight="medium">
          {label}
        </Text>
        <Text textStyle="2xs" color="fg.subtle" lineClamp={2}>
          {hint}
        </Text>
      </Box>
    </HStack>
  );
}

export function AgentActionsMenu({
  triggerLabel,
  size = "sm",
  assistant,
  copy,
  docs,
}: {
  /** Labels the outline button. */
  triggerLabel?: string;
  /** Match the sibling buttons of the surface this sits in. */
  size?: "sm" | "md";
  /** The hand-off to the assistant, where this reader has one. */
  assistant?: {
    prompt: string;
    label: string;
    hint: string;
    ask: (prompt: string) => void;
  };
  copy: {
    prompt: string;
    label: string;
    hint: string;
    copiedTitle: string;
  };
  docs: {
    href: string;
    label: string;
    hint: string;
  };
}) {
  const toaster = usePersonalToaster();

  // A toast, not an inline label: zag's menu closes on select, so any
  // confirmation rendered inside it would land in a menu that is already gone.
  // The toast also gives the clipboard-rejection path somewhere to go.
  const copyPrompt = () => {
    void navigator.clipboard?.writeText(copy.prompt).then(
      () => toaster.create({ type: "success", title: copy.copiedTitle }),
      () => toaster.create({ type: "error", title: "Couldn't copy the prompt" }),
    );
  };

  return (
    <Menu.Root positioning={{ placement: "bottom-end", gutter: 6 }}>
      <Menu.Trigger asChild>
        {/* The same outline/size the primary actions on these pages wear, so
            the control reads as one of the page's own buttons. */}
        <Button variant="outline" size={size} aria-haspopup="menu">
          <LuSparkles size={14} />
          {triggerLabel}
          <LuChevronDown size={14} />
        </Button>
      </Menu.Trigger>
      <Menu.Content minWidth="300px" padding={1}>
        {assistant && (
          <Menu.Item
            value="ask-assistant"
            paddingY={2}
            onClick={() => assistant.ask(assistant.prompt)}
          >
            <AgentMenuOption icon={LuSparkles} label={assistant.label} hint={assistant.hint} />
          </Menu.Item>
        )}
        <Menu.Item value="copy-prompt" paddingY={2} onClick={copyPrompt}>
          <AgentMenuOption icon={LuTerminal} label={copy.label} hint={copy.hint} />
        </Menu.Item>
        <Menu.Item value="docs" paddingY={2} asChild>
          <chakra.a href={docs.href} target="_blank" rel="noreferrer">
            <AgentMenuOption icon={LuBookOpen} label={docs.label} hint={docs.hint} />
          </chakra.a>
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}
