import {
  Box,
  Button,
  HStack,
  Icon,
  IconButton,
  Text,
  VStack,
} from "@chakra-ui/react";
import posthog from "posthog-js";
import { useEffect, useState } from "react";
import { LuArrowRight, LuMessageCircle, LuSparkles, LuX } from "react-icons/lu";
import { Link } from "~/components/ui/link";
import { Tooltip } from "~/components/ui/tooltip";
import { setTracesV2Preferred } from "~/features/traces-v2/hooks/useTracesV2Preference";
import { useFeatureFlag } from "~/hooks/useFeatureFlag";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

const SNOOZE_DAYS = 7;
const SNOOZE_MS = SNOOZE_DAYS * 24 * 60 * 60 * 1000;
// Versioned so prior dismissals from earlier copy/iterations don't keep the
// banner permanently hidden. Bump when the message materially changes.
const STORAGE_PREFIX = "langwatch:tracesV2-promo-dismissed:v9:";

type PromoMode = "try" | "request";

function storageKey(projectId: string, mode: PromoMode): string {
  return `${STORAGE_PREFIX}${mode}:${projectId}`;
}

function isSnoozed(projectId: string, mode: PromoMode): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = localStorage.getItem(storageKey(projectId, mode));
    if (!raw) return false;
    const expiresAt = Number(raw);
    if (!Number.isFinite(expiresAt)) return false;
    return expiresAt > Date.now();
  } catch {
    return false;
  }
}

function snooze(projectId: string, mode: PromoMode): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      storageKey(projectId, mode),
      String(Date.now() + SNOOZE_MS),
    );
  } catch {
    // No-op: best-effort dismissal.
  }
}

/**
 * Clear every per-project snooze key for the v2 promo so the banner
 * reappears on the next render. Called when the operator opts back
 * out of v2 from the new drawer's overflow menu — at that point we
 * want the promo to be available again the next time they open the
 * legacy drawer, not stuck in "snoozed for 7 days".
 *
 * Also dispatches the in-tab event the promo subscribes to so the
 * currently-mounted promo (if any) re-runs its `isSnoozed` check
 * without waiting for a remount.
 */
export function resetTracesV2PromoSnooze(): void {
  if (typeof window === "undefined") return;
  try {
    const toDelete: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(STORAGE_PREFIX)) toDelete.push(key);
    }
    for (const key of toDelete) localStorage.removeItem(key);
    window.dispatchEvent(new CustomEvent("langwatch:traces-v2-promo-reset"));
  } catch {
    // best-effort
  }
}

function openCrispChat(): boolean {
  if (typeof window === "undefined") return false;
  const crisp = (
    window as unknown as { $crisp?: { push: (args: unknown[]) => void } }
  ).$crisp;
  if (!crisp) return false;
  crisp.push(["do", "chat:show"]);
  crisp.push(["do", "chat:toggle"]);
  return true;
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
  const { enabled: tracesV2Enabled, isLoading: tracesV2FlagLoading } =
    useFeatureFlag("release_ui_traces_v2_enabled", {
      projectId,
      enabled: !!projectId,
    });
  const mode: PromoMode = tracesV2Enabled ? "try" : "request";
  const [dismissed, setDismissed] = useState(false);
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  useEffect(() => {
    if (projectId) setDismissed(isSnoozed(projectId, mode));
  }, [projectId, mode]);

  // Re-evaluate dismissed when the operator opts out of v2 from the
  // new drawer (which calls `resetTracesV2PromoSnooze` and dispatches
  // this event). Without this subscription the banner would stay
  // hidden until the 7-day snooze expired or the page reloaded.
  useEffect(() => {
    const onReset = () => {
      if (projectId) setDismissed(isSnoozed(projectId, mode));
    };
    window.addEventListener("langwatch:traces-v2-promo-reset", onReset);
    return () =>
      window.removeEventListener("langwatch:traces-v2-promo-reset", onReset);
  }, [projectId, mode]);

  if (!hasMounted || !projectSlug || tracesV2FlagLoading || dismissed) {
    return null;
  }

  const handleDismiss = () => {
    if (projectId) snooze(projectId, mode);
    setDismissed(true);
  };

  // Going hard-nav rather than openDrawer: the v1→v2 swap kept losing
  // races against Chakra's unmount-fired onOpenChange (which calls
  // goBack and pops the freshly-pushed v2 entry). Two rounds of
  // increasingly elaborate guards (URL snapshot, live window.location,
  // module-level transition flag) still misfired under live testing.
  // A full window.location navigation gives us a deterministic clean
  // slate — every in-flight drawer state is dropped, the page reloads
  // with traceV2Details as the only drawer. v1 is going away soon
  // anyway, so the page reload cost is short-lived.
  const handleTryV2 = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!traceId) {
      if (projectSlug) {
        window.location.href = `/${projectSlug}/traces`;
      }
      return;
    }
    setTracesV2Preferred(true);
    posthog.capture("traces_v2_opt_in", {
      surface: "promo_banner",
      projectId,
      traceId,
    });
    if (projectId) snooze(projectId, mode);
    // Preserve every non-drawer query param (`span`, filters, time
    // range, …) so the underlying scenario / list view stays put;
    // only swap the drawer.* params.
    const url = new URL(window.location.href);
    const drawerKeys: string[] = [];
    url.searchParams.forEach((_, key) => {
      if (key.startsWith("drawer.")) drawerKeys.push(key);
    });
    for (const key of drawerKeys) url.searchParams.delete(key);
    url.searchParams.set("drawer.open", "traceV2Details");
    url.searchParams.set("drawer.traceId", traceId);
    window.location.href = url.toString();
  };

  const requestAccessMailto = `mailto:support@langwatch.ai?subject=${encodeURIComponent(
    "Early access to the new Trace Explorer",
  )}&body=${encodeURIComponent(
    "Hi! I'd like early access to the new Trace Explorer" +
      (project?.slug ? ` for project "${project.slug}"` : "") +
      ".",
  )}`;

  const handleRequestAccess = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (openCrispChat()) {
      e.preventDefault();
    }
  };

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
            {mode === "try"
              ? "Try the new Trace Explorer"
              : "A new Trace Explorer is on the way"}
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
              {mode === "try" ? "Beta" : "Coming soon"}
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
            {mode === "try"
              ? "A tracing experience you'd introduce to your family. We'd love to hear your feedback — tell us what you love, and what you hate."
              : "A faster, friendlier tracing experience is in private beta. Want in early? Get in touch and we'll switch it on for you."}
          </Text>
        )}
      </VStack>
      {mode === "try" ? (
        <Button
          size={isCompact ? "xs" : "sm"}
          aria-label="Try the new Trace Explorer"
          bg="white"
          color="purple.700"
          fontWeight="600"
          paddingX={isCompact ? 3 : 4}
          boxShadow="0 1px 2px rgba(0, 0, 0, 0.12)"
          _hover={{ bg: "white/90", transform: "translateY(-1px)" }}
          _active={{ bg: "white/80", transform: "translateY(0)" }}
          transition="background-color 0.12s ease, transform 0.12s ease"
          onClick={handleTryV2}
        >
          Try the new one
          <Icon as={LuArrowRight} boxSize={3.5} marginLeft={1} />
        </Button>
      ) : (
        <Link
          href={requestAccessMailto}
          onClick={handleRequestAccess}
          aria-label="Request early access to the new Trace Explorer"
        >
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
            <Icon as={LuMessageCircle} boxSize={3.5} marginRight={1} />
            Request early access
          </Button>
        </Link>
      )}
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
