import {
  Box,
  Button,
  HStack,
  Icon,
  IconButton,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { LuArrowRight, LuSparkles, LuX } from "react-icons/lu";
import { Link } from "~/components/ui/link";
import { Tooltip } from "~/components/ui/tooltip";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

const SNOOZE_DAYS = 7;
const SNOOZE_MS = SNOOZE_DAYS * 24 * 60 * 60 * 1000;
// Versioned so prior dismissals from earlier copy/iterations don't keep the
// banner permanently hidden. Bump when the message materially changes.
const STORAGE_PREFIX = "langwatch:tracesV2-promo-dismissed:v7:";

function storageKey(projectId: string): string {
  return `${STORAGE_PREFIX}${projectId}`;
}

function isSnoozed(projectId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = localStorage.getItem(storageKey(projectId));
    if (!raw) return false;
    const expiresAt = Number(raw);
    if (!Number.isFinite(expiresAt)) return false;
    return expiresAt > Date.now();
  } catch {
    return false;
  }
}

function snooze(projectId: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(storageKey(projectId), String(Date.now() + SNOOZE_MS));
  } catch {
    // No-op: best-effort dismissal.
  }
}

interface NewTracesPromoProps {
  variant?: "full" | "compact";
  /** When set, the CTA deep-links to this trace inside the v2 drawer. */
  traceId?: string;
}

export function NewTracesPromo({
  variant = "full",
  traceId,
}: NewTracesPromoProps) {
  const { project } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  const projectId = project?.id;
  const projectSlug = project?.slug;
  const [dismissed, setDismissed] = useState(false);
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    setHasMounted(true);
    if (projectId) setDismissed(isSnoozed(projectId));
  }, [projectId]);

  if (!hasMounted || !projectSlug || dismissed) {
    return null;
  }

  const handleDismiss = () => {
    if (projectId) snooze(projectId);
    setDismissed(true);
  };

  const v2Href = traceId
    ? `/${projectSlug}/traces?drawer.open=traceV2Details&drawer.traceId=${encodeURIComponent(traceId)}`
    : `/${projectSlug}/traces`;

  const isCompact = variant === "compact";

  return (
    <HStack
      width="full"
      gap={{ base: 2.5, md: 3.5 }}
      paddingX={{ base: 4, md: 5 }}
      paddingY={isCompact ? 2.5 : 3}
      align="center"
      color="white"
      borderTopRadius="inherit"
      bgImage="linear-gradient(120deg, var(--chakra-colors-purple-700) 0%, var(--chakra-colors-purple-500) 55%, var(--chakra-colors-pink-500) 100%)"
      _dark={{
        bgImage:
          "linear-gradient(120deg, var(--chakra-colors-purple-800) 0%, var(--chakra-colors-purple-600) 55%, var(--chakra-colors-pink-600) 100%)",
      }}
      boxShadow="inset 0 -1px 0 rgba(0, 0, 0, 0.18)"
      flexShrink={0}
    >
      <Box
        flexShrink={0}
        display="flex"
        alignItems="center"
        justifyContent="center"
        boxSize={isCompact ? "28px" : "34px"}
        borderRadius="full"
        bg="white/20"
        boxShadow="inset 0 0 0 1px rgba(255, 255, 255, 0.3)"
      >
        <Icon as={LuSparkles} boxSize={isCompact ? 3.5 : 4} color="white" />
      </Box>
      <VStack align="start" gap={isCompact ? 0 : 0.5} flex={1} minWidth={0}>
        <HStack gap={2} minWidth={0} width="full">
          <Text
            textStyle={isCompact ? "xs" : "sm"}
            fontWeight="600"
            color="white"
            letterSpacing="-0.005em"
            truncate
          >
            Try the new Trace View
          </Text>
          <Box
            paddingX={1.5}
            paddingY="2px"
            borderRadius="full"
            bg="white/30"
            flexShrink={0}
          >
            <Text
              textStyle="2xs"
              fontWeight="700"
              color="white"
              letterSpacing="0.08em"
              textTransform="uppercase"
              lineHeight={1.2}
            >
              Beta
            </Text>
          </Box>
        </HStack>
        {!isCompact && (
          <Text
            textStyle="xs"
            color="white/90"
            lineHeight={1.45}
            css={{
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            A tracing experience you'd actually introduce to your family. We'd
            love to hear your feedback — tell us what you love, and what you hate.
          </Text>
        )}
      </VStack>
      <Link href={v2Href} aria-label="Open new tracing experience">
        <Button
          size={isCompact ? "xs" : "sm"}
          bg="white"
          color="purple.700"
          fontWeight="600"
          paddingX={isCompact ? 3 : 4}
          boxShadow="0 1px 2px rgba(0, 0, 0, 0.12)"
          _hover={{ bg: "white/90", transform: "translateY(-1px)" }}
          _active={{ bg: "white/80", transform: "translateY(0)" }}
          transition="background-color 0.12s ease, transform 0.12s ease"
        >
          Try the new one
          <Icon as={LuArrowRight} boxSize={3.5} marginLeft={1} />
        </Button>
      </Link>
      <Tooltip
        content={`Hide for ${SNOOZE_DAYS} days`}
        positioning={{ placement: "top" }}
      >
        <IconButton
          size={isCompact ? "xs" : "sm"}
          variant="ghost"
          color="white/80"
          _hover={{ bg: "white/20", color: "white" }}
          _active={{ bg: "white/30" }}
          onClick={handleDismiss}
          aria-label="Dismiss"
        >
          <LuX />
        </IconButton>
      </Tooltip>
    </HStack>
  );
}
