import { Box, Flex, Text } from "@chakra-ui/react";
import { RenderedMarkdown } from "../markdown/rendered-markdown";
import { asMarkdownBody } from "./parsing";
import { RoleChip } from "./role-chip";
import { TurnCollapseChevron } from "./turn-collapse-chevron";
import type { ContentBlock } from "./types";

export function SystemTurnView({
  role,
  blocks,
  onCollapse,
}: {
  role: "system" | "developer";
  blocks: ContentBlock[];
  onCollapse?: () => void;
}) {
  const text = blocks
    .filter((b): b is Extract<ContentBlock, { kind: "text" }> => b.kind === "text")
    .map((b) => b.text)
    .join("\n");
  return (
    <Box marginBottom={3}>
      <Flex align="center" justify="space-between" gap={2}>
        <RoleChip role={role} />
        {onCollapse && <TurnCollapseChevron onClick={onCollapse} />}
      </Flex>
      <Box textStyle="xs" color="fg.muted">
        {text ? (
          <RenderedMarkdown markdown={asMarkdownBody(text)} paddingX={0} paddingY={0} />
        ) : (
          <Text>—</Text>
        )}
      </Box>
    </Box>
  );
}
