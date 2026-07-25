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
import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import {
  ArrowUpRight,
  BarChart3,
  Bot,
  Boxes,
  Check,
  CheckSquare,
  Coins,
  Cpu,
  Database,
  FileText,
  FlaskConical,
  FolderKanban,
  Key,
  KeyRound,
  LayoutDashboard,
  type LucideIcon,
  MessagesSquare,
  Network,
  RadioTower,
  ShieldCheck,
  SlidersHorizontal,
  Tag,
  Trash2,
  Waypoints,
  Workflow,
  Zap,
} from "lucide-react";
import type { ReactNode } from "react";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import { LangySpaAnchor } from "../LangySpaAnchor";
import { langyThinkingShimmerStyles } from "../langyShimmer";
import type {
  CapabilityIconName,
  CapabilitySurface,
} from "./capabilityCatalog";
import {
  buildSurfaceHref,
  type CapabilityTone,
  SURFACE_LABEL,
} from "./capabilityRegistry";

const SURFACE_ICON: Record<CapabilitySurface, LucideIcon> = {
  traces: Waypoints,
  analytics: BarChart3,
  experiments: FlaskConical,
  evaluations: ShieldCheck,
  evaluators: CheckSquare,
  datasets: Database,
  prompts: FileText,
  dashboards: LayoutDashboard,
  simulations: MessagesSquare,
  scenarios: MessagesSquare,
  agents: Bot,
  automations: Zap,
  workflows: Workflow,
  annotations: Tag,
  secrets: KeyRound,
  projects: FolderKanban,
  apiKeys: Key,
  modelProviders: Cpu,
  gateway: Network,
  platform: Boxes,
};

/**
 * The glyph behind each icon name a catalog row may override with. The names
 * live in the data-only catalog; the JSX-side binding lives here, exhaustively,
 * so naming an icon the kit doesn't have is a type error.
 */
const CATALOG_ICON: Record<CapabilityIconName, LucideIcon> = {
  key: Key,
  coins: Coins,
  radioTower: RadioTower,
  shieldCheck: ShieldCheck,
  slidersHorizontal: SlidersHorizontal,
};

// Overline colour + icon per tone. `read` leans on the surface icon (or the
// catalog's override for the resource); the result tones carry a status glyph
// (check / trash) so "done" reads instantly.
function toneOverline(
  tone: CapabilityTone,
  surface: CapabilitySurface,
  icon?: CapabilityIconName,
): { color: string; Icon: LucideIcon } {
  switch (tone) {
    case "created":
    case "updated":
      return { color: "green.fg", Icon: Check };
    case "removed":
      return { color: "red.fg", Icon: Trash2 };
    case "read":
    default:
      // paper/35 — a read is the quietest thing a card can be.
      return {
        color: "fg.subtle",
        Icon: icon ? CATALOG_ICON[icon] : SURFACE_ICON[surface],
      };
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
  icon,
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
  /** Overline icon override, when the surface icon isn't right for the resource. */
  icon?: CapabilityIconName;
}) {
  const { color, Icon } = toneOverline(tone, surface, icon);
  const showDeepLink = deepLink ?? true;
  const hasActions = actions !== undefined && actions !== null;

  return (
    <VStack
      align="stretch"
      gap={1.5}
      borderWidth="1px"
      borderStyle="solid"
      borderColor={tone === "removed" ? "red.emphasized" : "border.muted"}
      borderRadius="langyCard"
      background="bg.subtle"
      // `none`, on both grounds — see langyTheme.ts. The homepage's dark
      // sections contain no shadow at all; a card is separated from its ground
      // by a hairline and a few percent of white, and nothing else. Four
      // shadowed cards stacked in one turn read as a deck of trading cards.
      boxShadow="langyCard"
      paddingX="12px"
      paddingY="11px"
      role="group"
    >
      {/* The site's overline is `text-[10px] uppercase tracking-[0.03em]` at
          `text-paper/40` — MEDIUM weight and loose-ish tracking, not a bold
          all-caps stamp. 700-weight at 0.07em was shouting a category name at
          the reader before they got to the content. */}
      <HStack
        gap={1}
        textStyle="2xs"
        fontWeight="500"
        letterSpacing="0.03em"
        textTransform="uppercase"
        color={color}
      >
        <Icon size={11} />
        <Text as="span">{overline}</Text>
      </HStack>

      {typeof title === "string" ? (
        <Text textStyle="xs" fontWeight="640" color="fg" lineHeight="1.3">
          {title}
        </Text>
      ) : (
        title
      )}

      {children}

      {showDeepLink || hasActions ? (
        <HStack gap={2} justify="space-between" align="center" flexWrap="wrap">
          <Box>{actions}</Box>
          {showDeepLink ? (
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
    <LangySpaAnchor
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
    </LangySpaAnchor>
  );
}

/**
 * Placeholder rows while a card hydrates its references — the count is already
 * known from the result's digest, so the card holds the right amount of space
 * and fills in instead of jumping. Same shimmer idiom as the pending card;
 * still, not animated, for people who prefer reduced motion.
 */
export function CapabilityRowSkeletons({ count }: { count: number }) {
  const reduce = useReducedMotion();
  const shimmer = reduce
    ? { ...langyThinkingShimmerStyles, animation: "none" }
    : langyThinkingShimmerStyles;
  return (
    <VStack align="stretch" gap={0} aria-hidden>
      {Array.from({ length: count }, (_, index) => (
        <VStack key={index} align="stretch" gap={1} paddingX={2} paddingY={1.5}>
          <Box textStyle="xs" css={shimmer} width={index % 2 ? "55%" : "70%"}>
            &nbsp;
          </Box>
          <Box textStyle="2xs" css={shimmer} width="40%">
            &nbsp;
          </Box>
        </VStack>
      ))}
    </VStack>
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
  const hasSecondary = secondary !== undefined && secondary !== null;
  const body = (
    <VStack align="stretch" gap={0} flex={1} minWidth={0}>
      <Text textStyle="xs" color="fg" truncate>
        {primary}
      </Text>
      {hasSecondary ? (
        <Text textStyle="2xs" color="fg.muted" truncate>
          {secondary}
        </Text>
      ) : null}
    </VStack>
  );

  if (href) {
    return (
      <LangySpaAnchor
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
      </LangySpaAnchor>
    );
  }
  return (
    <HStack gap={2} paddingX={2} paddingY={1.5}>
      {body}
    </HStack>
  );
}
