import { Box, Button, Link, Text } from "@langwatch/design-system/primitives";
import { Play } from "lucide-react";
import { Children, isValidElement, useEffect, useRef, useState } from "react";
import type { ComponentProps } from "react";

import { sitePath } from "../../../lib/site-path.ts";

/** A local media URL under the site's base path; external and relative URLs pass through. */
function mediaPath({ path }: { path?: string }) {
  return path ? sitePath({ path }) : path;
}

/** Prefixes each candidate URL of a `srcset`, keeping its width or density descriptor. */
function mediaSrcSet({ srcSet }: { srcSet?: string }) {
  return srcSet
    ?.split(",")
    .map((candidate) => {
      const [url = "", ...descriptors] = candidate.trim().split(/\s+/);
      return [sitePath({ path: url }), ...descriptors].join(" ");
    })
    .join(", ");
}

function themeClass({ className }: { className?: string }): string {
  if (!className) return "";
  if (className.includes("dark:hidden")) return "docs-light-only";
  if (className.includes("dark:block")) return "docs-dark-only";
  return "";
}

/** Broken images retain their authored alternative text. */
export function DocsImage({ className, alt, src, srcSet, width, ...rest }: ComponentProps<"img">) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <Link
        href={mediaPath({ path: src })}
        fontSize="14px"
        color="blue.fg"
        className={themeClass({ className })}
      >
        {alt || "Image unavailable"}
      </Link>
    );
  }
  return (
    <img
      className={`docs-img ${themeClass({ className })} ${className ?? ""}`.trim()}
      src={mediaPath({ path: src })}
      srcSet={mediaSrcSet({ srcSet })}
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

const TOUR_POSTER = { width: 1664, height: 1040, widths: [640, 1024, 1664] };
const TOUR_POSTER_SIZES =
  "(min-width: 1280px) calc(100vw - 620px), (min-width: 1024px) calc(100vw - 380px), calc(100vw - 40px)";

function tourPosterSet({ format }: { format: "avif" | "webp" }) {
  return TOUR_POSTER.widths
    .map(
      (width) =>
        `${sitePath({ path: `/media/posters/introduction-${width}.${format}` })} ${width}w`,
    )
    .join(", ");
}

/**
 * The tour's poster as a responsive picture, so a phone fetches a phone-sized modern image. It is
 * the docs home's largest paint at every width, so it is fetched first.
 */
function TourPoster() {
  return (
    <picture>
      <source
        type="image/avif"
        srcSet={tourPosterSet({ format: "avif" })}
        sizes={TOUR_POSTER_SIZES}
      />
      <source
        type="image/webp"
        srcSet={tourPosterSet({ format: "webp" })}
        sizes={TOUR_POSTER_SIZES}
      />
      <img
        src={sitePath({ path: "/media/posters/introduction.jpg" })}
        width={TOUR_POSTER.width}
        height={TOUR_POSTER.height}
        alt=""
        fetchPriority="high"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          borderRadius: "var(--chakra-radii-xl)",
        }}
      />
    </picture>
  );
}

export function DocsVideo({ autoPlay, children, src, poster, ...rest }: ComponentProps<"video">) {
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
  if ("data-docs-clip" in rest) {
    return (
      <video
        {...rest}
        src={mediaPath({ path: src })}
        poster={mediaPath({ path: poster })}
        style={{ display: "block", maxWidth: "100%", height: "auto" }}
        controls
        muted
        loop
        playsInline
        preload="none"
      >
        {children}
      </video>
    );
  }
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
          src={mediaPath({ path: src })}
          poster={introduction ? undefined : mediaPath({ path: poster })}
          style={{
            display: "block",
            width: "100%",
            height: "auto",
            aspectRatio: introduction ? `${TOUR_POSTER.width} / ${TOUR_POSTER.height}` : undefined,
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
            <TourPoster />
            <Button
              data-docs-video=""
              position="relative"
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

/** A video source under the site's base path; MDX `<source>` tags compile to this. */
export function DocsSource({ src, srcSet, ...rest }: ComponentProps<"source">) {
  return <source {...rest} src={mediaPath({ path: src })} srcSet={mediaSrcSet({ srcSet })} />;
}

export function DocsIframe({ title, src, ...rest }: ComponentProps<"iframe">) {
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
        src={mediaPath({ path: src })}
      />
    </Box>
  );
}
