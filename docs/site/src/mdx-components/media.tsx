import { Box } from "@langwatch/design-system/primitives";
import { useEffect, useRef, useState } from "react";
import type { ComponentProps } from "react";

function themeClass({ className }: { className?: string }): string {
  if (!className) return "";
  if (className.includes("dark:hidden")) return "docs-light-only";
  if (className.includes("dark:block")) return "docs-dark-only";
  return "";
}

/** Images keep their intrinsic aspect; a light/dark pair stays exclusive; a broken source shows its alt. */
export function DocsImage({ className, alt, src, width, ...rest }: ComponentProps<"img">) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <Box as="a" href={src} fontSize="14px" color="blue.fg" className={themeClass({ className })}>
        {alt || "Image unavailable"}
      </Box>
    );
  }
  return (
    <img
      className={`docs-img ${themeClass({ className })}`.trim()}
      src={src}
      alt={alt ?? ""}
      loading="lazy"
      decoding="async"
      style={{ maxWidth: "100%", height: "auto", width: typeof width === "string" && width.endsWith("%") ? width : undefined }}
      width={typeof width === "string" && width.endsWith("%") ? undefined : width}
      onError={() => setFailed(true)}
      {...rest}
    />
  );
}

/** Authored autoplay is kept only when motion is welcome; otherwise the first frame waits for Play. */
export function DocsVideo({ autoPlay, ...rest }: ComponentProps<"video">) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) ref.current?.pause();
  }, []);
  return (
    <Box marginY="6" maxWidth="720px" marginX="auto">
      <video ref={ref} autoPlay={autoPlay} playsInline preload="metadata" style={{ display: "block", width: "100%", height: "auto", borderRadius: "var(--chakra-radii-showcase)" }} {...rest} />
    </Box>
  );
}

export function DocsIframe({ title, ...rest }: ComponentProps<"iframe">) {
  return (
    <Box marginY="6" borderWidth="1px" borderColor="border" borderRadius="showcase" overflow="hidden" css={{ aspectRatio: "16 / 9" }}>
      <iframe title={title ?? "Embedded content"} loading="lazy" style={{ width: "100%", height: "100%", border: 0 }} {...rest} />
    </Box>
  );
}
