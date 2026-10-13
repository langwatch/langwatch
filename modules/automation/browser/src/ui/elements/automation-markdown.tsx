/**
 * Markdown, as a template's help text needs it -- not `platform/app`'s
 * `~/components/Markdown`, which carries an image proxy, a code renderer
 * and the router a variable's description doesn't need. `react-markdown` plus GFM.
 */

import { Box, type BoxProps } from "@langwatch/design-system/primitives";
import { TYPE_SCALE_PX } from "@langwatch/design-system/typography";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function AutomationMarkdown({ children, ...props }: BoxProps & { children: string }) {
  return (
    <Box
      css={{
        "& p": { marginBottom: "0.5rem" },
        "& p:last-child": { marginBottom: 0 },
        "& code": { fontSize: `${TYPE_SCALE_PX.caption}px` },
        "& ul, & ol": { paddingLeft: "1.25rem" },
      }}
      {...props}
    >
      <Markdown remarkPlugins={[remarkGfm]}>{children}</Markdown>
    </Box>
  );
}
