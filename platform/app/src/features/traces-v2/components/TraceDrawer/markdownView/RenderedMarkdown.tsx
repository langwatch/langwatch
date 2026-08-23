import { Box } from "@chakra-ui/react";
import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useColorMode } from "~/components/ui/color-mode";
import { buildMarkdownComponents } from "./components";

/**
 * Reusable rendered-markdown block. Maps markdown → Chakra components so
 * typography, spacing, colors, links, tables all inherit from the theme.
 * Shiki handles fenced code blocks via the ambient
 * `<CodeBlock.AdapterProvider>` mounted at `TraceV2DrawerShell`.
 */
export function RenderedMarkdown({
  markdown,
  paddingX = 2,
  paddingY = 1.5,
}: {
  markdown: string;
  paddingX?: number;
  paddingY?: number;
}) {
  const { colorMode } = useColorMode();
  const components = useMemo(
    () => buildMarkdownComponents(colorMode),
    [colorMode],
  );

  return (
    // overflowWrap inherits into every prose element below, so unbreakable
    // tokens (URLs, JSON blobs) wrap instead of painting past the box. It is
    // inert inside `white-space: pre` code blocks, which keep their own
    // horizontal scroll.
    <Box
      paddingX={paddingX}
      paddingY={paddingY}
      color="fg"
      overflowWrap="anywhere"
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {markdown}
      </ReactMarkdown>
    </Box>
  );
}
