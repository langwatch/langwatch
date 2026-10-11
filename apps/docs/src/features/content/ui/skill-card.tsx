import { Box, Flex, Text } from "@langwatch/design-system/primitives";

import { CodeBody, CopyAction } from "../../code/ui/code-parts.tsx";

function Command({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <Box minWidth="0">
      <Text margin="0" marginBottom="2" fontSize="12px" color="fg.muted">
        {label}
      </Text>
      <Flex alignItems="center" bg="bg.subtle" borderRadius="lg" paddingStart="3" minHeight="40px">
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
        <CopyAction code={value} label={`Copy ${label.toLowerCase()}`} />
      </Flex>
    </Box>
  );
}

export function SkillCard({
  title,
  install,
  command,
  prompt,
}: {
  title: string;
  install: string;
  command: string;
  prompt: string;
}) {
  return (
    <Box
      className="docs-skill-card"
      borderWidth="1px"
      borderColor="border"
      borderRadius="xl"
      padding="5"
      marginY="4"
    >
      <Text
        as="h3"
        margin="0"
        marginBottom="4"
        fontSize="16px"
        lineHeight="24px"
        fontWeight="600"
        color="fg"
      >
        {title}
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
        <Box marginTop="4" borderTopWidth="1px" borderColor="border.muted" paddingTop="2">
          <Flex alignItems="center" justifyContent="space-between" fontSize="13px">
            <span>Run without installing</span>
            <Flex alignItems="center">
              <span>Copy full prompt</span>
              <CopyAction code={prompt} label="Copy full prompt" />
            </Flex>
          </Flex>
          <details>
            <summary>View prompt</summary>
            <CodeBody
              source={{
                lang: "text",
                title: "Prompt",
                code: prompt,
                lines: prompt
                  .split("\n")
                  .map((line) => line.replaceAll("&", "&amp;").replaceAll("<", "&lt;")),
                numbered: false,
                highlight: [],
              }}
            />
          </details>
        </Box>
      ) : null}
    </Box>
  );
}
