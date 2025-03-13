import { useEffect, useState } from "react";
import { Box, Image, Text } from "@chakra-ui/react";
import { Tooltip } from "../components/ui/tooltip";

export const isImageUrl = (str: string): boolean => {
  if (!str) {
    return false;
  }

  // Check for base64 image
  if (str.startsWith("data:image/")) {
    const base64Regex =
      /^data:image\/(jpeg|jpg|gif|png|webp|svg\+xml|bmp);base64,/i;
    return base64Regex.test(str);
  }

  try {
    // Try to create URL object to validate URL format
    const url_ = new URL(str);

    // Check for common image extensions
    const imageExtensionRegex = /\.(jpeg|jpg|gif|png|webp|svg|bmp)(\?.*)?$/i;

    // Check if URL contains an image file extension
    if (imageExtensionRegex.test(str)) {
      return true;
    }

    // Check if url is from commonly used image hosting sites which don't end up in the imageExtensionRegex
    if (
      url_.hostname.endsWith("gstatic.com") ||
      url_.hostname.endsWith("googleusercontent.com")
    ) {
      return true;
    }

    return false;
  } catch {
    return false;
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
  ...props
}: {
  alt?: string;
  src: string;
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
