import { Box, Button, Link, Text } from "@langwatch/design-system/primitives";
import { Play } from "lucide-react";
import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ComponentProps } from "react";

import { BASE_PATH, withBasePath } from "../../../lib/site-path.ts";

/** The base path media URLs are served under: the build's own unless a render provides one. */
export const MediaBasePath = createContext(BASE_PATH);

/** A local media URL under the site's base path; external and relative URLs pass through. */
function mediaPath({ basePath, path }: { basePath: string; path?: string }) {
  return path ? withBasePath({ basePath, path }) : path;
}

/** Prefixes each candidate URL of a `srcset`, keeping its width or density descriptor. */
function mediaSrcSet({ basePath, srcSet }: { basePath: string; srcSet?: string }) {
  return srcSet
    ?.split(",")
    .map((candidate) => {
      const [url = "", ...descriptors] = candidate.trim().split(/\s+/);
      return [withBasePath({ basePath, path: url }), ...descriptors].join(" ");
    })
    .join(", ");
}

function themeClass({ className }: { className?: string }): string {
  if (!className) return "";
  if (className.includes("dark:hidden")) return "docs-light-only";
  if (className.includes("dark:block")) return "docs-dark-only";
  return "";
}

/** True inside a Frame, whose own window already holds the media. */
export const InFrame = createContext(false);

/** Screenshots get the window bar, SVG diagrams only the frame, external badges stay inline. */
export function shotKind({ src }: { src?: string }): "bare" | "diagram" | "shot" {
  if (!src || /^https?:/.test(src)) return "bare";
  return /\.svg($|[?#])/.test(src) ? "diagram" : "shot";
}

/** Broken images retain their authored alternative text. */
export function DocsImage({ className, alt, src, srcSet, width, ...rest }: ComponentProps<"img">) {
  const [failed, setFailed] = useState(false);
  const basePath = useContext(MediaBasePath);
  const kind = useContext(InFrame) ? "bare" : shotKind({ src });
  const percent = typeof width === "string" && width.endsWith("%") ? width : undefined;
  if (failed) {
    return (
      <Link
        href={mediaPath({ basePath, path: src })}
        fontSize="14px"
        color="blue.fg"
        className={themeClass({ className })}
      >
        {alt || "Image unavailable"}
      </Link>
    );
  }
  const image = (
    <img
      className={`docs-img ${kind === "bare" ? themeClass({ className }) : ""} ${className ?? ""}`
        .replace(/\s+/g, " ")
        .trim()}
      src={mediaPath({ basePath, path: src })}
      srcSet={mediaSrcSet({ basePath, srcSet })}
      alt={alt ?? ""}
      loading="lazy"
      decoding="async"
      style={{
        maxWidth: "100%",
        height: "auto",
        width: percent && kind === "bare" ? percent : undefined,
      }}
      width={percent ? undefined : width}
      onError={() => setFailed(true)}
      {...rest}
    />
  );
  if (kind === "bare") return image;
  return (
    <span
      className={`docs-shot ${themeClass({ className })}`.trim()}
      data-shot={kind}
      style={percent ? { width: percent } : undefined}
    >
      {image}
    </span>
  );
}

const TOUR_POSTER = { width: 1664, height: 1040, widths: [640, 1024, 1664] };
const TOUR_POSTER_SIZES =
  "(min-width: 1280px) calc(100vw - 620px), (min-width: 1024px) calc(100vw - 380px), calc(100vw - 40px)";

function tourPosterSet({ basePath, format }: { basePath: string; format: "avif" | "webp" }) {
  return TOUR_POSTER.widths
    .map(
      (width) =>
        `${withBasePath({ basePath, path: `/media/posters/introduction-${width}.${format}` })} ${width}w`,
    )
    .join(", ");
}

/**
 * The tour's poster as a responsive picture, so a phone fetches a phone-sized modern image. It is
 * the docs home's largest paint at every width, so it is fetched first.
 */
function TourPoster() {
  const basePath = useContext(MediaBasePath);
  return (
    <picture>
      <source
        type="image/avif"
        srcSet={tourPosterSet({ basePath, format: "avif" })}
        sizes={TOUR_POSTER_SIZES}
      />
      <source
        type="image/webp"
        srcSet={tourPosterSet({ basePath, format: "webp" })}
        sizes={TOUR_POSTER_SIZES}
      />
      <img
        src={withBasePath({ basePath, path: "/media/posters/introduction.jpg" })}
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
  const basePath = useContext(MediaBasePath);
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
        src={mediaPath({ basePath, path: src })}
        poster={mediaPath({ basePath, path: poster })}
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
          data-docs-tour={introduction ? "" : undefined}
          playsInline
          preload={introduction ? "none" : "metadata"}
          src={mediaPath({ basePath, path: src })}
          poster={introduction ? undefined : mediaPath({ basePath, path: poster })}
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
  const basePath = useContext(MediaBasePath);
  return (
    <source
      {...rest}
      src={mediaPath({ basePath, path: src })}
      srcSet={mediaSrcSet({ basePath, srcSet })}
    />
  );
}

/** A YouTube embed's privacy-enhanced address, or null for any other frame. */
export function youtubeEmbed({ src }: { src?: string }) {
  const id = /^https:\/\/www\.youtube(?:-nocookie)?\.com\/embed\/([\w-]+)/.exec(src ?? "")?.[1];
  return id ? `https://www.youtube-nocookie.com/embed/${id}` : null;
}

/* A YouTube player loads only when the reader presses play: until then the page fetches none of
   its scripts and sets none of its cookies. The media island swaps the button for the player. */
export function DocsIframe({ title, src, ...rest }: ComponentProps<"iframe">) {
  const basePath = useContext(MediaBasePath);
  const embed = youtubeEmbed({ src });
  const name = title ?? "Embedded content";
  return (
    <Box
      marginY="6"
      width={embed ? "720px" : void 0}
      maxWidth="100%"
      borderWidth="1px"
      borderColor="border"
      borderRadius="showcase"
      overflow="hidden"
      css={{ aspectRatio: "16 / 9" }}
    >
      {embed ? (
        <button
          type="button"
          className="docs-embed-play"
          data-docs-video=""
          data-docs-embed={embed}
          data-docs-embed-title={name}
          aria-label={`Play the video: ${name}`}
        >
          <Play size={28} aria-hidden="true" />
          <span>Play the video</span>
        </button>
      ) : (
        <iframe
          title={name}
          loading="lazy"
          style={{ width: "100%", height: "100%", border: 0 }}
          {...rest}
          src={mediaPath({ basePath, path: src })}
        />
      )}
    </Box>
  );
}
