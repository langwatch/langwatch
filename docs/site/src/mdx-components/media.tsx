import { Box, Button, Link, Text } from "@langwatch/design-system/primitives";
import { Play } from "lucide-react";
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
  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState(false);
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
  const playbackFailed = () => {
    setStarted(false);
    setFailed(true);
  };
  const start = async () => {
    if (failed) ref.current?.load();
    setFailed(false);
    setStarted(true);
    try {
      await ref.current?.play();
    } catch {
      playbackFailed();
    }
  };
  return (
    <Box as="figure" marginY="8" maxWidth="none" marginX="auto">
      <Box position="relative">
        <video
          ref={ref}
          playsInline
          preload={introduction ? "none" : "metadata"}
          poster={introduction ? "/posters/introduction.jpg" : rest.poster}
          style={{
            display: "block",
            width: "100%",
            height: "auto",
            borderRadius: "var(--chakra-radii-xl)",
            boxShadow: "0 8px 24px var(--chakra-colors-docs-shadow-strong)",
          }}
          {...rest}
          onErrorCapture={playbackFailed}
          controls={introduction ? started : rest.controls}
          muted
        >
          {children}
        </video>
        {introduction && !started ? (
          <Box
            position="absolute"
            inset="0"
            display="flex"
            alignItems="center"
            justifyContent="center"
          >
            <Button
              onClick={start}
              minHeight="48px"
              borderRadius="full"
              paddingX="6"
              bg="docs.paper"
              color="fg"
              boxShadow="0 4px 24px var(--chakra-colors-docs-shadow-strong)"
              _hover={{ bg: "bg.subtle" }}
            >
              <Play size={17} aria-hidden="true" /> Watch the product tour
            </Button>
          </Box>
        ) : null}
      </Box>
      {failed ? (
        <Text role="alert" color="red.fg" fontSize="14px" marginTop="3">
          The video could not load. Try playing it again.
        </Text>
      ) : null}
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
