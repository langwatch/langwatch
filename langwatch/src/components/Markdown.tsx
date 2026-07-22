import { createLogger } from "@langwatch/observability";
import { chakra } from "@chakra-ui/react";
import { ArrowUpRight } from "lucide-react";
import { useRouter } from "~/utils/compat/next-router";
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
 *
 * A backslash disqualifies the href too: browsers recover from `/\evil.com`
 * (or `\/evil.com`) by normalising `\` to `/`, so it resolves as the
 * protocol-relative `//evil.com` — an off-site jump wearing a leading slash.
 * The WHATWG URL spec doesn't sanction that, but real browsers do it, so the
 * guard rejects any backslash rather than trust a `startsWith("//")` check
 * that the browser is about to sidestep.
 *
 * Tab / newline / carriage-return are rejected for the same reason: the URL
 * parser STRIPS them before resolving, so `/\t/evil.com` collapses to
 * `//evil.com` and escapes the `startsWith("//")` check the same way. Reject
 * any C0 control character rather than enumerate the three the spec strips.
 *
 * This is THE internal-href guard — `useSpaLinkClick` (features/langy) and
 * the panel's navigate handler use this same function; do not fork it.
 */
// eslint-disable-next-line no-control-regex -- intentionally matching C0 controls
const CONTROL_CHARS = /[\u0000-\u001f]/;

// The PERCENT-ENCODED forms of the same rejected bytes: markdown's
// `defaultUrlTransform` encodes a literal `\\` to `%5C` (and C0 controls to
// `%0x`/`%1x`) before the href ever reaches this guard, so the raw-byte
// checks alone would wave the disguised form through to the router.
const ENCODED_REJECTS = /%5c|%0[0-9a-f]|%1[0-9a-f]/i;

export function isInternalHref(href: string): boolean {
  return (
    href.startsWith("/") &&
    !href.startsWith("//") &&
    !href.includes("\\") &&
    !CONTROL_CHARS.test(href) &&
    !ENCODED_REJECTS.test(href)
  );
}

/**
 * The SPA path of an ABSOLUTE url that stays on this app instance, null for
 * anything else. Langy references resources by their absolute platform link
 * (`BASE_HOST + path`); when that origin is the page's own, the link must
 * ride the SPA router — a new tab or full load would tear down the
 * persistent panel mid-conversation.
 */
function sameOriginSpaPath(href: string): string | null {
  if (!/^https?:\/\//i.test(href)) return null;
  try {
    const url = new URL(href);
    if (url.origin !== window.location.origin) return null;
    const path = url.pathname + url.search + url.hash;
    return isInternalHref(path) ? path : null;
  } catch {
    return null;
  }
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
  // An absolute http(s) destination normally leaves the app: it gets Chakra's
  // external link treatment (new tab, `rel="noopener noreferrer"`) instead of
  // navigating the SPA away mid-read — UNLESS its origin is this instance's
  // own (Langy's platform links are absolute), in which case its path rides
  // the SPA router like any in-app link. Relative in-app paths SPA-navigate
  // so the surrounding page (and an open Langy panel) stays mounted.
  const spaPath = isInternalHref(href) ? href : sameOriginSpaPath(href);
  const isExternal = /^https?:\/\//i.test(href) && !spaPath;

  /** SPA-navigate an in-app destination; anything else gets a real navigation. */
  const navigate = () => {
    if (spaPath) {
      void router.push(spaPath);
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
        spaPath &&
        event.button === 0 &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.shiftKey &&
        !event.altKey
      ) {
        event.preventDefault();
        void router.push(spaPath);
      }
    },
  };

  return (
    <>
      {isExternal ? (
        <UiLink {...rest} {...styleProps} href={href} isExternal>
          {children}
          {langy ? (
            // Langy spends its one accent on navigation, so a link that
            // LEAVES the app must say so before it is clicked.
            <chakra.span
              aria-label="opens outside LangWatch"
              display="inline-flex"
              verticalAlign="baseline"
              marginLeft="2px"
            >
              <ArrowUpRight size={11} aria-hidden="true" />
            </chakra.span>
          ) : null}
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
