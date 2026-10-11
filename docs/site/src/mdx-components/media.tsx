import { Box, Link, Text } from "@langwatch/design-system/primitives";
import { Children, isValidElement, useEffect, useRef, useState } from "react";
import type { ComponentProps } from "react";

function themeClass({ className }: { className?: string }): string {
  if (!className) return "";
  if (className.includes("dark:hidden")) return "docs-light-only";
  if (className.includes("dark:block")) return "docs-dark-only";
  return "";
}

/** Broken images retain their authored alternative text. */
export function DocsImage({ className, alt, src, width, ...rest }: ComponentProps<"img">) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <Link href={src} fontSize="14px" color="blue.fg" className={themeClass({ className })}>
        {alt || "Image unavailable"}
      </Link>
    );
  }
  return (
    <img
      className={`docs-img ${themeClass({ className })}`.trim()}
      src={src}
      alt={alt ?? ""}
      loading="lazy"
      decoding="async"
      style={{
        maxWidth: "100%",
        height: "auto",
        width: typeof width === "string" && width.endsWith("%") ? width : undefined,
      }}
      width={typeof width === "string" && width.endsWith("%") ? undefined : width}
      onError={() => setFailed(true)}
      {...rest}
    />
  );
}

export function DocsVideo({ autoPlay, children, ...rest }: ComponentProps<"video">) {
  const ref = useRef<HTMLVideoElement>(null);
  const introduction = Children.toArray(children).some(
    (child) =>
      isValidElement<{ src?: string }>(child) &&
      child.props.src === "/media/videos/introduction.webm",
  );
  useEffect(() => {
    if (
      autoPlay &&
      !introduction &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      ref.current?.play().catch(() => {});
    }
  }, [autoPlay, introduction]);
  return (
    <Box as="figure" marginY="8" maxWidth="720px" marginX="auto">
      <video
        ref={ref}
        playsInline
        preload={introduction ? "none" : "metadata"}
        poster={introduction ? "/posters/introduction.jpg" : rest.poster}
        style={{
          display: "block",
          width: "100%",
          height: "auto",
          borderRadius: "var(--chakra-radii-showcase)",
        }}
        {...rest}
      >
        {children}
      </video>
      {introduction ? (
        <Text as="figcaption" marginTop="3" fontSize="13px" lineHeight="20px" color="fg.muted">
          Follow a request through its trace, inspect each span and see where time is spent.
        </Text>
      ) : null}
    </Box>
  );
}

export function DocsIframe({ title, ...rest }: ComponentProps<"iframe">) {
  return (
    <Box
      marginY="6"
      borderWidth="1px"
      borderColor="border"
      borderRadius="showcase"
      overflow="hidden"
      css={{ aspectRatio: "16 / 9" }}
    >
      <iframe
        title={title ?? "Embedded content"}
        loading="lazy"
        style={{ width: "100%", height: "100%", border: 0 }}
        {...rest}
      />
    </Box>
  );
}
