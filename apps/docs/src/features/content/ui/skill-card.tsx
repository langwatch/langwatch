import { Box, Flex, Text } from "@langwatch/design-system/primitives";
import { Sparkles, Terminal, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

import { CopyAction } from "../../code/ui/code-parts.tsx";
import { PROMPT_BODY_ATTRIBUTE } from "./prompt-attributes.ts";

function Command({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <Box minWidth="0">
      <Text margin="0" marginBottom="1" fontSize="12px" color="docs.body">
        {label}
      </Text>
      <Flex
        alignItems="center"
        gap="2"
        bg="bg.subtle"
        borderWidth="1px"
        borderColor="border"
        borderRadius="lg"
        paddingStart="3"
        minHeight="40px"
      >
        <Terminal size={14} aria-hidden="true" />
        <Box
          as="code"
          flex="1"
          minWidth="0"
          fontFamily="mono"
          fontSize="13px"
          overflowWrap="anywhere"
        >
          {value}
        </Box>
        <CopyAction code={value} label={`Copy ${label.toLowerCase()}`} source="button" />
      </Flex>
    </Box>
  );
}

export function SkillCard({
  title,
  install,
  command,
  prompt,
  children,
}: {
  title: string;
  install: string;
  command: string;
  prompt: string;
  children?: ReactNode;
}) {
  return (
    <Box
      className="docs-skill-card"
      borderWidth="1px"
      borderColor="border"
      borderRadius="xl"
      padding="4"
      bg="bg.surface"
      marginY="4"
    >
      <Text
        as="h3"
        margin="0"
        marginBottom="3"
        fontSize="16px"
        lineHeight="24px"
        fontWeight="600"
        color="fg"
        display="flex"
        alignItems="center"
        gap="2"
      >
        <Sparkles size={18} aria-hidden="true" /> {title}
      </Text>
      <Box
        display="grid"
        gridTemplateColumns={{ base: "minmax(0, 1fr)", md: "minmax(0, 2fr) minmax(0, 1fr)" }}
        gap="3"
      >
        <Command label="Install via CLI" value={install} />
        <Command label="Skill command" value={command} />
      </Box>
      {prompt ? (
        <Box marginTop="4" borderTopWidth="1px" borderColor="border" paddingTop="3">
          <Flex alignItems="center" justifyContent="space-between" fontSize="13px">
            <span>Or paste the prompt into your agent</span>
            <Flex alignItems="center">
              <CopyAction code={prompt} label="Copy full prompt" showLabel source="prompt" />
            </Flex>
          </Flex>
          <details className="docs-skill-prompt">
            <summary>
              View prompt <ChevronDown size={16} aria-hidden="true" />
            </summary>
            <Box
              {...{ [PROMPT_BODY_ATTRIBUTE]: "" }}
              className="docs-skill-body docs-prose"
              fontSize="14px"
              lineHeight="24px"
              overflowWrap="anywhere"
            >
              {children}
            </Box>
          </details>
        </Box>
      ) : null}
    </Box>
  );
}
