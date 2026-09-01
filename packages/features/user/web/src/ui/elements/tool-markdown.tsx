/**
 * The Markdown an administrator wrote about an internal tool.
 *
 * `platform/app`'s `Markdown` is two hundred and fifty lines: an image proxy, a
 * code renderer, a confirm dialog for outbound links and the application's own
 * router. A feature-web package may not import any of that, and none of it is
 * what a tool tile needs — a tile prints a paragraph or two of description that
 * the organization's own administrator wrote.
 *
 * So this is `react-markdown` with GitHub-flavoured tables and no plugins of
 * its own. Raw HTML is not enabled, which is the default and the point: the
 * text is authored in one organization's catalogue and read by everyone in it.
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
