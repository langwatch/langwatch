import { createLogger } from "@langwatch/observability";
import { chakra } from "@chakra-ui/react";
import {
  Children,
  isValidElement,
  memo,
  type ReactNode,
  useState,
} from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { stringifyIfObject } from "~/utils/stringifyIfObject";
import { useRouter } from "~/utils/compat/next-router";
import { ConfirmDialog } from "./gateway/ConfirmDialog";
import { RenderCode } from "./code/RenderCode";
import { getProxiedImageUrl } from "./ExternalImage";
import { Link as UiLink } from "./ui/link";
import { Prose } from "./ui/prose";

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
  fontSize = "14px",
  linkVariant = "default",
  color,
  children,
}: {
  className?: string;
  /**
   * Prose base size. Every spacing in the Prose snippet is em-based, so the
   * whole scale follows. Chat surfaces (Langy) read at 13px; docs-like pages
   * keep the 14px default.
   */
  fontSize?: string;
  /** Langy spends its one accent on useful navigation. */
  linkVariant?: "default" | "langy";
  /**
   * Base text colour, overriding Prose's full-brightness `fg`. Langy dims its
   * answers a step below the user's words so the hierarchy reads at a glance.
   */
  color?: string;
  children: string;
}) {
  if (typeof children !== "string") {
    logger.warn(
      { children, stringified: stringifyIfObject(children) },
      "Markdown component received non-string children. Stringifying it to avoid errors.",
    );
  }

  const urlTransform = (url: string) =>
    url.startsWith("data:") ? url : defaultUrlTransform(url);

  return (
    <Prose
      className={className}
      fontSize={fontSize}
      maxWidth="none"
      {...(color ? { color } : {})}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={urlTransform}
        components={{
          a({ children: linkChildren, href, ...rest }) {
            return (
              <MarkdownLink href={href} variant={linkVariant} {...rest}>
                {linkChildren}
              </MarkdownLink>
            );
          },
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
              return (
                <code className={className} {...rest}>
                  {code}
                </code>
              );
            }
          },
        }}
      >
        {proxyMarkdownImageUrls(stringifyIfObject(children))}
      </ReactMarkdown>
    </Prose>
  );
}

function textOf(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number") {
        return String(child);
      }
      if (isValidElement<{ children?: ReactNode }>(child)) {
        return textOf(child.props.children);
      }
      return "";
    })
    .join("")
    .trim();
}

/**
 * A same-app destination we can hand to the SPA router — an absolute path like
 * `/my-project/messages/abc123`. Protocol-relative (`//host`) and absolute
 * (`https://…`) URLs are external and must get a real navigation, so a trace
 * link inside the app stays SPA while a GitHub PR link opens for real.
 */
export function isInternalHref(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//");
}

function normaliseDisplayedUrl(value: string): string | null {
  const clean = value.trim().replace(/[.,;:!?]+$/, "");
  if (!/^https?:\/\//i.test(clean)) return null;
  try {
    const parsed = new URL(clean);
    parsed.hash = "";
    return parsed.href.replace(/\/$/, "");
  } catch {
    return null;
  }
}

function isMismatchedUrlLabel(label: string, href: string): boolean {
  const shown = normaliseDisplayedUrl(label);
  const destination = normaliseDisplayedUrl(href);
  return shown !== null && destination !== null && shown !== destination;
}

function MarkdownLink({
  children,
  href = "",
  variant,
  ...rest
}: {
  children?: ReactNode;
  href?: string;
  variant: "default" | "langy";
} & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "color">) {
  const router = useRouter();
  const [warningOpen, setWarningOpen] = useState(false);
  const label = textOf(children);
  const mismatched = isMismatchedUrlLabel(label, href);
  const langy = variant === "langy";
  // An absolute http(s) destination leaves the app: it gets Chakra's external
  // link treatment (new tab, `rel="noopener noreferrer"`) instead of
  // navigating the SPA away mid-read. In-app paths SPA-navigate through the
  // router so the surrounding page (and an open Langy panel) stays mounted.
  const isExternal = /^https?:\/\//i.test(href);

  /** SPA-navigate an in-app path; anything else gets a real navigation. */
  const navigate = () => {
    if (isInternalHref(href)) {
      void router.push(href);
    } else {
      window.location.assign(href);
    }
  };

  const styleProps = {
    color: langy ? "orange.fg" : undefined,
    textDecorationColor: langy ? "orange.muted" : undefined,
    background: mismatched ? "orange.subtle" : undefined,
    borderRadius: mismatched ? "sm" : undefined,
    paddingX: mismatched ? "2px" : undefined,
    // Keep a markdown-authored title (`[text](url "title")`) unless the
    // mismatch warning needs the slot.
    title: mismatched ? `Displayed URL differs from ${href}` : rest.title,
    "data-mismatched-url": mismatched ? "true" : undefined,
    onClick: (event: React.MouseEvent<HTMLAnchorElement>) => {
      rest.onClick?.(event);
      if (event.defaultPrevented) return;
      if (mismatched) {
        event.preventDefault();
        setWarningOpen(true);
        return;
      }
      // Plain left click on an in-app link: SPA-navigate. Modified clicks
      // (cmd/ctrl/shift/middle) keep the real anchor behaviour — new tab,
      // "open in new tab", etc.
      if (
        isInternalHref(href) &&
        event.button === 0 &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.shiftKey &&
        !event.altKey
      ) {
        event.preventDefault();
        void router.push(href);
      }
    },
  };

  return (
    <>
      {isExternal ? (
        <UiLink {...rest} {...styleProps} href={href} isExternal>
          {children}
        </UiLink>
      ) : (
        <chakra.a {...rest} {...styleProps} href={href}>
          {children}
        </chakra.a>
      )}
      {mismatched ? (
        <ConfirmDialog
          open={warningOpen}
          onOpenChange={setWarningOpen}
          title="This link goes somewhere different"
          message={`The link text shows ${label}, but its destination is ${href}. Only continue if you trust it.`}
          confirmLabel="Open anyway"
          tone="warning"
          onConfirm={() => {
            setWarningOpen(false);
            if (isExternal) {
              window.open(href, "_blank", "noopener,noreferrer");
            } else {
              navigate();
            }
          }}
        />
      ) : null}
    </>
  );
}

export const Markdown = memo(
  MarkdownWithPluginsAndProxy,
  (prevProps, nextProps) =>
    prevProps.className === nextProps.className &&
    prevProps.fontSize === nextProps.fontSize &&
    prevProps.linkVariant === nextProps.linkVariant &&
    prevProps.color === nextProps.color &&
    prevProps.children === nextProps.children,
);
