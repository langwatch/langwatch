import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getProxiedImageUrl } from "./ExternalImage";

export const proxyMarkdownImageUrls = (markdown: string): string => {
  // Matches markdown image syntax: ![description](url)
  const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;

  return markdown.replace(imageRegex, (match, description, url) => {
    const proxiedUrl = getProxiedImageUrl(url);
    return `![${description}](${proxiedUrl})`;
  });
};

function MarkdownWithPluginsAndProxy({
  className,
  children,
}: {
  className?: string;
  children: string;
}) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} className={className}>
      {proxyMarkdownImageUrls(children)}
    </ReactMarkdown>
  );
}

export const Markdown = memo(
  MarkdownWithPluginsAndProxy,
  (prevProps, nextProps) =>
    prevProps.className === nextProps.className &&
    prevProps.children === nextProps.children
);
