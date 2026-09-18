/**
 * Markdown renderer for tool descriptions (GitHub flavour, no HTML).
 * Lightweight subset for feature-web packages (no platform dependencies).
 */

import { chakra } from "@chakra-ui/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const MarkdownRoot = chakra("div", {
  base: {
    "& p": { marginBottom: "0.5rem" },
    "& p:last-child": { marginBottom: 0 },
    "& ul, & ol": { paddingLeft: "1.25rem", marginBottom: "0.5rem" },
    "& li": { listStyle: "revert" },
    "& a": { textDecoration: "underline" },
    "& code": { fontFamily: "mono", fontSize: "0.9em" },
  },
});

export function ToolMarkdown({ children }: { children: string }) {
  return (
    <MarkdownRoot>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </MarkdownRoot>
  );
}
