/**
 * Markdown, as a template's help text needs it -- not `platform/app`'s
 * `~/components/Markdown`, which carries an image proxy, a code renderer
 * and the router a variable's description doesn't need. `react-markdown` plus GFM.
 */

import { Box, type BoxProps } from "@chakra-ui/react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function AutomationMarkdown({ children, ...props }: BoxProps & { children: string }) {
  return (
    <Box
      css={{
        "& p": { marginBottom: "0.5rem" },
        "& p:last-child": { marginBottom: 0 },
        "& code": { fontSize: "0.85em" },
        "& ul, & ol": { paddingLeft: "1.25rem" },
      }}
      {...props}
    >
      <Markdown remarkPlugins={[remarkGfm]}>{children}</Markdown>
    </Box>
  );
}
