/**
 * A picture in a dataset cell, expandable in place.
 *
 * A NARROWED family-local copy of `platform/app/src/components/ExternalImage`:
 * the editor only ever renders the expandable variant, so the "open in a new
 * tab" and `dontLinkify` modes did not travel. The platform component keeps
 * them for the trace media strip and the results panels, which deletes-only
 * forbids repointing.
 *
 * Escape closes the expanded picture. The listener exists only while it is
 * open: the backdrop is a full-viewport click catcher, and an overlay that
 * swallows pointer events while ignoring the key a reader reaches for first is
 * worse than merely unresponsive.
 */

import { Box, Image, Portal, Text } from "@chakra-ui/react";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { useCallback, useEffect, useRef, useState } from "react";
import { proxiedDatasetImageUrl } from "../../model/dataset-image-url";

/** Kept clear of the viewport edge so the expanded picture is never flush. */
const VIEWPORT_MARGIN = 32;

export function DatasetCellImage({
  src,
  alt,
  ...props
}: {
  src: string;
  alt?: string;
} & Record<string, unknown>) {
  const [failed, setFailed] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  /** The centre of the thumbnail, so the expanded copy grows out of it. */
  const [origin, setOrigin] = useState({ centerX: 0, centerY: 0 });
  /** Applied after measuring, to pull the expanded copy back into the viewport. */
  const [clamp, setClamp] = useState({ top: 0, left: 0 });
  const [isPositioned, setIsPositioned] = useState(false);
  const thumbnailRef = useRef<HTMLImageElement>(null);
  const expandedRef = useRef<HTMLDivElement>(null);
  const proxiedSrc = proxiedDatasetImageUrl(src);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  useEffect(() => {
    if (!isExpanded || !expandedRef.current) return;
    // After layout: the image has to have sized before its overflow is known.
    requestAnimationFrame(() => {
      if (!expandedRef.current) return;
      const rect = expandedRef.current.getBoundingClientRect();
      const left = origin.centerX - rect.width / 2;
      const top = origin.centerY - rect.height / 2;
      const right = left + rect.width;
      const bottom = top + rect.height;

      let offsetLeft = 0;
      let offsetTop = 0;
      if (right > window.innerWidth - VIEWPORT_MARGIN) {
        offsetLeft = window.innerWidth - VIEWPORT_MARGIN - right;
      }
      if (left + offsetLeft < VIEWPORT_MARGIN) offsetLeft = VIEWPORT_MARGIN - left;
      if (bottom > window.innerHeight - VIEWPORT_MARGIN) {
        offsetTop = window.innerHeight - VIEWPORT_MARGIN - bottom;
      }
      if (top + offsetTop < VIEWPORT_MARGIN) offsetTop = VIEWPORT_MARGIN - top;

      setClamp({ top: offsetTop, left: offsetLeft });
      setIsPositioned(true);
    });
  }, [isExpanded, origin]);

  const close = useCallback(() => {
    setIsExpanded(false);
    setIsPositioned(false);
  }, []);

  useEffect(() => {
    if (!isExpanded) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isExpanded, close]);

  const expand = useCallback(() => {
    const rect = thumbnailRef.current?.getBoundingClientRect();
    if (rect) {
      setOrigin({
        centerX: rect.left + rect.width / 2,
        centerY: rect.top + rect.height / 2,
      });
      setClamp({ top: 0, left: 0 });
      setIsPositioned(false);
    }
    setIsExpanded(true);
  }, []);

  if (failed) {
    return (
      <Tooltip
        content={<Text lineClamp={1}>Failed to load image: {src}</Text>}
        showArrow
        positioning={{ placement: "top" }}
      >
        <Box
          border="1px solid"
          borderColor="border.emphasized"
          borderRadius="2px"
          {...props}
          display="inline-flex"
          alignItems="center"
          justifyContent="center"
          width={(props.width as string) ?? "42px"}
          height={(props.height as string) ?? "48px"}
        >
          <Image src="/images/broken-image.svg" alt="Broken Image" width="40%" />
        </Box>
      </Tooltip>
    );
  }

  return (
    <>
      <Image
        ref={thumbnailRef}
        alt={alt}
        src={proxiedSrc}
        cursor="pointer"
        onError={() => setFailed(true)}
        onClick={expand}
        {...props}
      />
      {isExpanded && (
        <Portal>
          <Box
            position="fixed"
            inset={0}
            zIndex={1000}
            onClick={close}
            data-testid="expanded-image-backdrop"
          />
          <Box
            ref={expandedRef}
            position="fixed"
            top={`${origin.centerY + clamp.top}px`}
            left={`${origin.centerX + clamp.left}px`}
            transform="translate(-50%, -50%)"
            maxWidth={`calc(100vw - ${VIEWPORT_MARGIN * 2}px)`}
            maxHeight={`calc(100vh - ${VIEWPORT_MARGIN * 2}px)`}
            bg="white/75"
            backdropFilter="blur(8px)"
            borderRadius="md"
            boxShadow="0 0 0 2px var(--chakra-colors-gray-300), 0 4px 12px rgba(0,0,0,0.15)"
            zIndex={1001}
            padding={2}
            overflow="auto"
            opacity={isPositioned ? 1 : 0}
            css={{ animation: isPositioned ? "scale-in 0.15s ease-out" : "none" }}
          >
            <Image
              alt={alt}
              src={proxiedSrc}
              maxWidth="min(90vw, 900px)"
              maxHeight={`calc(100vh - ${VIEWPORT_MARGIN * 2 + 16}px)`}
              objectFit="contain"
              cursor="pointer"
              onClick={close}
            />
          </Box>
        </Portal>
      )}
    </>
  );
}
