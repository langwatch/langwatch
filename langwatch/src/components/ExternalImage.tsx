import { Box, Image, Portal, Text } from "@chakra-ui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Tooltip } from "../components/ui/tooltip";

export const getImageUrl = (str: unknown): string | null => {
  if (!str) {
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  const str_ = str.toString().trim();

  // Check for markdown image format ![alt](url)
  const markdownImageRegex = /^\!\[.*?\]\((.*?)\)$/;
  const markdownMatch = str_.match(markdownImageRegex);
  if (markdownMatch?.[1]) {
    // Extract the URL from markdown format and validate it recursively
    return markdownMatch[1] ?? null;
  }

  // Check for base64 image
  if (str_.startsWith("data:image/")) {
    const base64Regex =
      /^data:image\/(jpeg|jpg|gif|png|webp|svg\+xml|bmp);base64,/i;
    return str_.match(base64Regex)?.[0] ?? null;
  }

  try {
    // Try to create URL object to validate URL format
    const url_ = new URL(str_);

    // Check for common image extensions
    const imageExtensionRegex = /\.(jpeg|jpg|gif|png|webp|svg|bmp)(\?.*)?$/i;

    // Check if URL contains an image file extension
    if (imageExtensionRegex.test(str_)) {
      return str_;
    }

    // Check if url is from commonly used image hosting sites which don't end up in the imageExtensionRegex
    if (
      url_.hostname.endsWith("gstatic.com") ||
      url_.hostname.endsWith("googleusercontent.com")
    ) {
      return str_;
    }

    // Check for URLs that might be images without traditional extensions
    const pathname = url_.pathname;
    if (pathname && pathname.length > 30) {
      // Check if the URL path contains image-related keywords
      const imageKeywords = /image|img|photo|pic|picture|media|content|upload/i;
      if (imageKeywords.test(pathname)) {
        return str_;
      }

      // Check for long base64-like segments (likely encoded image data)
      const pathSegments = pathname.split("/");
      const lastSegment = pathSegments[pathSegments.length - 1];

      if (
        lastSegment &&
        lastSegment.length > 50 &&
        /^[A-Za-z0-9+/=]+$/.test(lastSegment)
      ) {
        return str_;
      }
    }

    return null;
  } catch {
    return null;
  }
};

export const getProxiedImageUrl = (url: string): string => {
  if (!url) return url;
  if (url.startsWith("data:")) return url;
  if (url.startsWith("/")) return url;

  return `/image-proxy?url=${encodeURIComponent(url)}`;
};

export const ExternalImage = ({
  alt,
  src,
  dontLinkify = false,
  expandable = false,
  ...props
}: {
  alt?: string;
  src: string;
  dontLinkify?: boolean;
  /** When true, clicking expands the image in place instead of opening new tab */
  expandable?: boolean;
  [key: string]: any;
}) => {
  const [error, setError] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  // Store center point of original image
  const [expandedPosition, setExpandedPosition] = useState({ centerX: 0, centerY: 0 });
  // Offset to apply after clamping to viewport (0,0 means perfectly centered)
  const [clampOffset, setClampOffset] = useState({ top: 0, left: 0 });
  const [isPositioned, setIsPositioned] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const expandedRef = useRef<HTMLDivElement>(null);
  const proxiedSrc = getProxiedImageUrl(src);

  const VIEWPORT_MARGIN = 32;

  useEffect(() => {
    setError(false);
  }, [src]);

  // Calculate clamp offset after expanded container renders
  useEffect(() => {
    if (isExpanded && expandedRef.current) {
      // Use requestAnimationFrame to ensure the image has loaded and sized
      requestAnimationFrame(() => {
        if (!expandedRef.current) return;

        const rect = expandedRef.current.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        // Current position (centered via CSS transform)
        // The element is at centerX, centerY with transform: translate(-50%, -50%)
        // So its edges are:
        const currentLeft = expandedPosition.centerX - rect.width / 2;
        const currentTop = expandedPosition.centerY - rect.height / 2;
        const currentRight = currentLeft + rect.width;
        const currentBottom = currentTop + rect.height;

        let offsetLeft = 0;
        let offsetTop = 0;

        // Push left if overflowing right
        if (currentRight > viewportWidth - VIEWPORT_MARGIN) {
          offsetLeft = (viewportWidth - VIEWPORT_MARGIN) - currentRight;
        }
        // Push right if overflowing left
        if (currentLeft + offsetLeft < VIEWPORT_MARGIN) {
          offsetLeft = VIEWPORT_MARGIN - currentLeft;
        }
        // Push up if overflowing bottom
        if (currentBottom > viewportHeight - VIEWPORT_MARGIN) {
          offsetTop = (viewportHeight - VIEWPORT_MARGIN) - currentBottom;
        }
        // Push down if overflowing top
        if (currentTop + offsetTop < VIEWPORT_MARGIN) {
          offsetTop = VIEWPORT_MARGIN - currentTop;
        }

        setClampOffset({ top: offsetTop, left: offsetLeft });
        setIsPositioned(true);
      });
    }
  }, [isExpanded, expandedPosition]);

  const handleExpand = useCallback(() => {
    if (imageRef.current) {
      const rect = imageRef.current.getBoundingClientRect();
      // Calculate center of original image
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      setExpandedPosition({ centerX, centerY });
      setClampOffset({ top: 0, left: 0 });
      setIsPositioned(false);
    }
    setIsExpanded(true);
  }, []);

  const handleClose = useCallback(() => {
    setIsExpanded(false);
    setIsPositioned(false);
  }, []);

  if (error) {
    return (
      <Tooltip
        content={<Text lineClamp={1}>Failed to load image: {src}</Text>}
        showArrow
        positioning={{ placement: "top" }}
      >
        <Box
          border="1px solid"
          borderColor="gray.300"
          borderRadius="2px"
          {...props}
          display="inline-flex"
          alignItems="center"
          justifyContent="center"
          width={props.width ?? "42px"}
          height={props.height ?? "48px"}
        >
          <Image
            src="/images/broken-image.svg"
            alt="Broken Image"
            width="40%"
          />
        </Box>
      </Tooltip>
    );
  }

  if (dontLinkify) {
    return (
      <Image
        alt={alt}
        onError={() => setError(true)}
        src={proxiedSrc}
        {...props}
      />
    );
  }

  // Expandable mode - click to expand in place (centered on original image, clamped to viewport)
  if (expandable) {
    return (
      <>
        <Image
          ref={imageRef}
          alt={alt}
          onError={() => setError(true)}
          src={proxiedSrc}
          cursor="pointer"
          onClick={handleExpand}
          {...props}
        />
        {isExpanded && (
          <Portal>
            {/* Invisible backdrop to catch clicks outside */}
            <Box
              position="fixed"
              inset={0}
              zIndex={1000}
              onClick={handleClose}
              data-testid="expanded-image-backdrop"
            />
            {/* Expanded image - centered on cell via CSS, with JS offset for viewport clamping */}
            <Box
              ref={expandedRef}
              position="fixed"
              top={`${expandedPosition.centerY + clampOffset.top}px`}
              left={`${expandedPosition.centerX + clampOffset.left}px`}
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
              css={{
                animation: isPositioned ? "scale-in 0.15s ease-out" : "none",
              }}
            >
              <Image
                alt={alt}
                src={proxiedSrc}
                maxWidth="min(90vw, 900px)"
                maxHeight={`calc(100vh - ${VIEWPORT_MARGIN * 2 + 16}px)`}
                objectFit="contain"
                cursor="pointer"
                onClick={handleClose}
              />
            </Box>
          </Portal>
        )}
      </>
    );
  }

  // Default: open in new tab
  return (
    <a href={src} target="_blank" rel="noopener noreferrer">
      <Image
        alt={alt}
        onError={() => setError(true)}
        src={proxiedSrc}
        {...props}
      />
    </a>
  );
};
