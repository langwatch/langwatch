import { Box, chakra, HStack, Icon, Link, Text } from "@chakra-ui/react";
import { AlertCircle, ChevronDown, ChevronUp, X } from "lucide-react";
import type React from "react";
import { useState } from "react";
import type { AiActionError } from "~/server/app-layer/traces/ai-query";
import { useFilterStore } from "../../stores/filterStore";
import { AiErrorDetails, hasAiErrorDetails } from "./ErrorBannerDetail";

/**
 * Error surface for the FloatingAiBar. The floating bar covers the docked
 * search bar (where the unified error banner lives) while AI mode is
 * active, so a failure must render inside the floating overlay itself —
 * otherwise the request fails with no visible feedback at all (customer
 * report: Ask AI "does nothing", the provider_error only visible in the
 * network tab).
 *
 * Provider errors additionally deep-link to Model Providers settings:
 * they almost always trace back to the project's model configuration
 * (wrong deployment, disabled provider, stale credentials), and the
 * operator can't act on a bare "Resource not found".
 */
export const FloatingAiErrorRow: React.FC<{ error: AiActionError }> = ({
  error,
}) => {
  const [expanded, setExpanded] = useState(false);
  const expandable = hasAiErrorDetails(error);
  const setAiError = useFilterStore((s) => s.setAiError);

  return (
    <Box
      role="alert"
      bg="bg.panel"
      borderWidth="1px"
      borderColor="red.emphasized"
      borderRadius="md"
      paddingX={2}
      paddingY={1}
      boxShadow="0 2px 6px rgba(0,0,0,0.1)"
      maxWidth="full"
      // The parent floating strip is click-transparent (it spans the whole
      // search-bar width); only this pill takes pointer events.
      pointerEvents="auto"
    >
      <HStack gap={1.5} align="center">
        <Icon color="red.fg" boxSize="11px" flexShrink={0}>
          <AlertCircle />
        </Icon>
        <Text textStyle="2xs" color="red.fg" lineHeight="1.3">
          {error.message}
        </Text>
        {error.code === "provider_error" && (
          <Link
            href="/settings/model-providers"
            textStyle="2xs"
            color="blue.fg"
            fontWeight="600"
            flexShrink={0}
            marginLeft={1}
          >
            Review model providers
          </Link>
        )}
        {expandable && (
          <chakra.button
            aria-label={expanded ? "Hide error details" : "Show error details"}
            onClick={() => setExpanded((v) => !v)}
            cursor="pointer"
            display="inline-flex"
            alignItems="center"
            color="fg.muted"
          >
            <Icon boxSize="11px">
              {expanded ? <ChevronUp /> : <ChevronDown />}
            </Icon>
          </chakra.button>
        )}
        <chakra.button
          aria-label="Dismiss error"
          onClick={() => setAiError(null)}
          cursor="pointer"
          display="inline-flex"
          alignItems="center"
          color="fg.muted"
          flexShrink={0}
        >
          <Icon boxSize="11px">
            <X />
          </Icon>
        </chakra.button>
      </HStack>
      {expanded && (
        <Box paddingTop={1} paddingLeft={4}>
          <AiErrorDetails error={error} />
        </Box>
      )}
    </Box>
  );
};
