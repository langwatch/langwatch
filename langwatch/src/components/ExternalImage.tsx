import { Box, Image, Text } from "@chakra-ui/react";
import { useEffect, useState } from "react";
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
  ...props
}: {
  alt?: string;
  src: string;
  dontLinkify?: boolean;
  [key: string]: any;
}) => {
  const [error, setError] = useState(false);
  const proxiedSrc = getProxiedImageUrl(src);

  useEffect(() => {
    setError(false);
  }, [src]);

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
