/**
 * Shared shell for every domain-capability card (task #12).
 *
 * This is the reference's `.card` idiom rendered once, in semantic tokens: a
 * raised surface with a hairline border, a mono icon-overline, a title, an
 * optional body, and an optional actions row plus an "Open in <surface>" deep
 * link. The overline colour is driven by `tone` — neutral for a read, green
 * for a created/updated result, red for a removed one — so a card's intent is
 * legible before you read a word of it.
 *
 * Every bespoke card (Traces, Metrics, EvalRun, Dataset, Scenario, resource
 * results) composes THIS shell so the whole kit stays one visual system.
 */
import { Box, chakra, HStack, Text, VStack } from "@chakra-ui/react";
import {
  ArrowUpRight,
  BarChart3,
  Bot,
  Check,
  Database,
  FileText,
  FlaskConical,
  LayoutDashboard,
  MessagesSquare,
  type LucideIcon,
  ShieldCheck,
  Trash2,
  Waypoints,
  Zap,
} from "lucide-react";
import type { ReactNode } from "react";
import {
  buildSurfaceHref,
  type CapabilitySurface,
  type CapabilityTone,
  SURFACE_LABEL,
} from "./capabilityRegistry";

const SURFACE_ICON: Record<CapabilitySurface, LucideIcon> = {
  traces: Waypoints,
  analytics: BarChart3,
  experiments: FlaskConical,
  evaluations: ShieldCheck,
  datasets: Database,
  prompts: FileText,
  dashboards: LayoutDashboard,
  simulations: MessagesSquare,
  agents: Bot,
  automations: Zap,
};

// Overline colour + icon per tone. `read` leans on the surface icon; the
// result tones carry a status glyph (check / trash) so "done" reads instantly.
function toneOverline(
  tone: CapabilityTone,
  surface: CapabilitySurface,
): { color: string; Icon: LucideIcon } {
  switch (tone) {
    case "created":
    case "updated":
      return { color: "green.fg", Icon: Check };
    case "removed":
      return { color: "red.fg", Icon: Trash2 };
    case "read":
    default:
      return { color: "fg.muted", Icon: SURFACE_ICON[surface] };
  }
}

export function LangyCapabilityCard({
  tone,
  surface,
  overline,
  title,
  children,
  actions,
  deepLink,
  projectSlug,
  resourceId,
}: {
  tone: CapabilityTone;
  surface: CapabilitySurface;
  /** Mono overline label (e.g. "Traces", "New evaluator"). */
  overline: string;
  title: ReactNode;
  /** Card body: a row list, statcards, a diff, a summary line. */
  children?: ReactNode;
  /** Optional actions row (Apply/Discard live on ProposalCard, not here). */
  actions?: ReactNode;
  /** Show the "Open in <surface>" deep link. Defaults to true. */
  deepLink?: boolean;
  projectSlug?: string | null;
  resourceId?: string | null;
}) {
  const { color, Icon } = toneOverline(tone, surface);

  return (
    <VStack
      align="stretch"
      gap={2}
      borderWidth="1px"
      borderStyle="solid"
      borderColor={tone === "removed" ? "red.emphasized" : "border.muted"}
      borderRadius="14px"
      background="bg.subtle"
      paddingX="15px"
      paddingY="14px"
      role="group"
    >
      <HStack
        gap={1.5}
        textStyle="2xs"
        fontWeight="700"
        letterSpacing="0.07em"
        textTransform="uppercase"
        color={color}
      >
        <Icon size={11} />
        <Text as="span">{overline}</Text>
      </HStack>

      {typeof title === "string" ? (
        <Text textStyle="sm" fontWeight="640" color="fg" lineHeight="1.3">
          {title}
        </Text>
      ) : (
        title
      )}

      {children}

      {(deepLink ?? true) || actions ? (
        <HStack gap={2} justify="space-between" align="center" flexWrap="wrap">
          <Box>{actions}</Box>
          {(deepLink ?? true) ? (
            <CapabilityDeepLinkChip
              surface={surface}
              projectSlug={projectSlug}
              resourceId={resourceId}
            />
          ) : null}
        </HStack>
      ) : null}
    </VStack>
  );
}

/**
 * "Open in <surface>" chip — the deep link out of the chat into the surface a
 * capability touched. Hidden entirely when there's no project slug to build a
 * valid path from, so it never renders a dead link.
 */
export function CapabilityDeepLinkChip({
  surface,
  projectSlug,
  resourceId,
  label,
}: {
  surface: CapabilitySurface;
  projectSlug?: string | null;
  resourceId?: string | null;
  /** Override the default "Open in <surface>" copy. */
  label?: string;
}) {
  const href = buildSurfaceHref({ surface, projectSlug, resourceId });
  if (!href) return null;
  return (
    <chakra.a
      href={href}
      display="inline-flex"
      alignItems="center"
      gap={1}
      textStyle="xs"
      fontWeight="560"
      color="orange.solid"
      marginLeft="auto"
      _hover={{ textDecoration: "underline" }}
    >
      {label ?? `Open in ${SURFACE_LABEL[surface]}`}
      <ArrowUpRight size={12} />
    </chakra.a>
  );
}

/** A single labelled row inside a card body — used by list-style cards. */
export function CapabilityRow({
  href,
  primary,
  secondary,
}: {
  href?: string | null;
  primary: ReactNode;
  secondary?: ReactNode;
}) {
  const body = (
    <VStack align="stretch" gap={0} flex={1} minWidth={0}>
      <Text textStyle="xs" color="fg" truncate>
        {primary}
      </Text>
      {secondary ? (
        <Text textStyle="2xs" color="fg.muted" truncate>
          {secondary}
        </Text>
      ) : null}
    </VStack>
  );

  if (href) {
    return (
      <chakra.a
        href={href}
        display="flex"
        alignItems="center"
        gap={2}
        paddingX={2}
        paddingY={1.5}
        borderRadius="md"
        _hover={{ background: "bg.muted" }}
      >
        {body}
        <ArrowUpRight size={12} color="var(--chakra-colors-fg-subtle)" />
      </chakra.a>
    );
  }
  return (
    <HStack gap={2} paddingX={2} paddingY={1.5}>
      {body}
    </HStack>
  );
}
