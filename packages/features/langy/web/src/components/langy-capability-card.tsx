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
  Building2,
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
  Users,
  Waypoints,
  Workflow,
  Zap,
} from "lucide-react";
import type { ReactNode } from "react";
import type {
  CapabilityIconName,
  CapabilitySurface,
} from "../behaviour/langy-capability-catalog";
import { useReducedMotion } from "../hooks/use-reduced-motion";
import { langyThinkingShimmerStyles } from "../values/langy-shimmer";

export type LangyCapabilityTone = "read" | "created" | "updated" | "removed";

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
  organization: Building2,
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
  users: Users,
  building: Building2,
};

// Overline colour + icon per tone. `read` leans on the surface icon (or the
// catalog's override for the resource); the result tones carry a status glyph
// (check / trash) so "done" reads instantly.
function toneOverline(
  tone: LangyCapabilityTone,
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
  footer,
  icon,
}: {
  tone: LangyCapabilityTone;
  surface: CapabilitySurface;
  /** Mono overline label (e.g. "Traces", "New evaluator"). */
  overline: string;
  title: ReactNode;
  /** Card body: a row list, statcards, a diff, a summary line. */
  children?: ReactNode;
  /** Controlled app-owned actions and navigation. */
  footer?: ReactNode;
  /** Overline icon override, when the surface icon isn't right for the resource. */
  icon?: CapabilityIconName;
}) {
  const { color, Icon } = toneOverline(tone, surface, icon);

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

      {footer}
    </VStack>
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
