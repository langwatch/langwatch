import { Box, Text } from "@chakra-ui/react";
import { RenderedMarkdown } from "../markdownView";
import { asMarkdownBody } from "./parsing";
import { RoleChip } from "./RoleChip";
import type { ContentBlock } from "./types";

export function SystemTurnView({
  role,
  blocks,
}: {
  role: "system" | "developer";
  blocks: ContentBlock[];
}) {
  const text = blocks
    .filter(
      (b): b is Extract<ContentBlock, { kind: "text" }> => b.kind === "text",
    )
    .map((b) => b.text)
    .join("\n");
  return (
    <Box marginBottom={3}>
      <RoleChip role={role} />
      <Box paddingLeft={4} textStyle="xs" color="fg.muted">
        {text ? (
          <RenderedMarkdown
            markdown={asMarkdownBody(text)}
            paddingX={0}
            paddingY={0}
          />
        ) : (
          <Text>—</Text>
        )}
      </Box>
    </Box>
  );
}
