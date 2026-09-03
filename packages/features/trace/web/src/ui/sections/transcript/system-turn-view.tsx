import { Box, Flex, Text } from "@chakra-ui/react";
import { RenderedMarkdown } from "../../blocks/markdown/rendered-markdown";
import { asMarkdownBody } from "../../../behavior/transcript/parsing";
import { RoleChip } from "../../blocks/transcript/role-chip";
import { TurnCollapseChevron } from "../../elements/transcript/turn-collapse-chevron";
import type { ContentBlock } from "../../../model/transcript/types";

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
