import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getProxiedImageUrl } from "./ExternalImage";
import { stringifyIfObject } from "~/utils/stringifyIfObject";
import { createLogger } from "~/utils/logger";
import { RenderCode } from "./code/RenderCode";

const logger = createLogger("langwatch:components:Markdown");

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
  if (typeof children !== "string") {
    logger.warn(
      { children, stringified: stringifyIfObject(children) },
      "Markdown component received non-string children. Stringifying it to avoid errors."
    );
  }

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      className={className}
      components={{
        code(props) {
          const { children, className, ...rest } = props;
          const match = /language-(\w+)/.exec(className ?? "");
          const code = String(children).replace(/\n$/, "");

          if (code.includes("\n")) {
            return (
              <RenderCode
                language={match ? match[1]! : ""}
                code={String(children).replace(/\n$/, "")}
              />
            );
          } else {
            return <code className={className} {...rest}>{code}</code>;
          }
        },
      }}
    >
      {proxyMarkdownImageUrls(stringifyIfObject(children))}
    </ReactMarkdown>
  );
}

export const Markdown = memo(
  MarkdownWithPluginsAndProxy,
  (prevProps, nextProps) =>
    prevProps.className === nextProps.className &&
    prevProps.children === nextProps.children
);
