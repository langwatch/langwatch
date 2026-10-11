import { Box, Flex, IconButton, Link, Text } from "@langwatch/design-system/primitives";
import { Copy, Terminal } from "lucide-react";

export function AgentLauncher() {
  return (
    <Box className="docs-agent-launcher">
      <Flex alignItems="center" gap="2" marginBottom="3" color="fg">
        <Terminal size={16} aria-hidden="true" />
        <Text fontSize="13px" fontWeight="600" margin="0">
          Track your coding agent
        </Text>
      </Flex>
      <Flex alignItems="center" gap="1" justifyContent="space-between">
        <Box as="code" color="fg">
          npx langwatch{" "}
          <select aria-label="Coding agent" defaultValue="claude">
            <option value="claude">claude</option>
            <option value="codex">codex</option>
            <option value="copilot">copilot</option>
            <option value="gemini">gemini</option>
            <option value="opencode">opencode</option>
          </select>
        </Box>
        <IconButton
          type="button"
          disabled
          size="xs"
          variant="ghost"
          aria-label="Copy agent command"
          data-docs-copy="npx langwatch claude"
        >
          <Copy size={14} />
        </IconButton>
      </Flex>
      <Link href="/coding-agents/quickstart" fontSize="12px" color="accent.fg" marginTop="2">
        Setup guide →
      </Link>
      <output className="docs-sr-only" aria-live="polite" />
    </Box>
  );
}
