import { Box, Button, Icon, Portal, Text } from "@chakra-ui/react";
import { LuChevronDown } from "react-icons/lu";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

interface BelowFoldIndicatorProps {
  /** The scrollable container the indicator should observe. */
  scrollRef: RefObject<HTMLElement | null>;
  /** Pixels below the fold before the hint appears. */
  threshold?: number;
}

interface SectionSummary {
  label: string;
  count: number | null;
}

interface PillBounds {
  /** CSS pixels from the viewport bottom to the bottom of the pill. */
  bottom: number;
  /** CSS pixels from the viewport left to the horizontal centre of the pill. */
  centerX: number;
}

interface BelowFoldState {
  visible: boolean;
  sections: SectionSummary[];
  bounds: PillBounds;
}

const DEFAULT_THRESHOLD = 96;
const MAX_DISPLAYED_SECTIONS = 3;
const SCROLL_BEHAVIOR: ScrollBehavior = "smooth";
const SECTION_SELECTOR = "[data-section-label]";
const PILL_OFFSET_PX = 16;

const initialBounds: PillBounds = { bottom: 0, centerX: 0 };
const initialState: BelowFoldState = {
  visible: false,
  sections: [],
  bounds: initialBounds,
};

function pluralize(label: string, count: number): string {
  const lower = label.toLowerCase();
  if (count === 1 && lower.endsWith("s")) return lower.slice(0, -1);
  return lower;
}

function formatSection({ label, count }: SectionSummary): string {
  if (count == null || count === 0) return label.toLowerCase();
  return `${count} ${pluralize(label, count)}`;
}

/**
 * Glassy pill anchored to the scroll viewport's bottom-centre via a Portal +
 * fixed positioning, so flex/sticky/transform quirks in the surrounding drawer
 * layout can't shift it. Lists what's still below the fold by section type
 * (e.g. "5 evaluations · 3 events · 2 generations") and jumps to the bottom
 * on click.
 */
export function BelowFoldIndicator({
  scrollRef,
  threshold = DEFAULT_THRESHOLD,
}: BelowFoldIndicatorProps) {
  const [state, setState] = useState<BelowFoldState>(initialState);
  const rafRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const measure = () => {
      const remaining = el.scrollHeight - el.clientHeight - el.scrollTop;
      const rect = el.getBoundingClientRect();
      const bounds: PillBounds = {
        bottom: window.innerHeight - rect.bottom + PILL_OFFSET_PX,
        centerX: rect.left + rect.width / 2,
      };
      if (remaining <= threshold) {
        setState((s) => (s.visible ? { ...initialState, bounds } : s));
        return;
      }
      const viewportBottom = rect.bottom;
      const candidates = el.querySelectorAll<HTMLElement>(SECTION_SELECTOR);
      const sections: SectionSummary[] = [];
      for (const node of candidates) {
        const nodeRect = node.getBoundingClientRect();
        if (nodeRect.top <= viewportBottom - 8) continue;
        const label = (node.dataset.sectionLabel ?? "").trim();
        if (!label) continue;
        const rawCount = node.dataset.sectionCount;
        const parsedCount =
          rawCount != null && rawCount !== ""
            ? Number.parseInt(rawCount, 10)
            : null;
        const count = Number.isFinite(parsedCount) ? parsedCount : null;
        if (count === 0) continue;
        sections.push({ label, count: count ?? null });
      }
      setState({ visible: true, sections, bounds });
    };

    const onScroll = () => {
      if (rafRef.current != null) return;
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null;
        measure();
      });
    };

    measure();
    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", measure);
    const ro = new ResizeObserver(() => {
      measure();
    });
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);

    return () => {
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", measure);
      ro.disconnect();
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
      }
    };
  }, [scrollRef, threshold]);

  if (!state.visible) return null;

  const handleClick = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: SCROLL_BEHAVIOR });
  };

  const visibleSections = state.sections.slice(0, MAX_DISPLAYED_SECTIONS);
  const overflowCount = state.sections.length - visibleSections.length;
  const summaryParts = visibleSections.map(formatSection);
  if (overflowCount > 0) {
    summaryParts.push(`+${overflowCount} more`);
  }
  const summary = summaryParts.length > 0 ? summaryParts.join(" · ") : null;

  return (
    <Portal>
      <Box
        position="fixed"
        zIndex={1500}
        pointerEvents="none"
        style={{
          bottom: `${state.bounds.bottom}px`,
          left: `${state.bounds.centerX}px`,
          transform: "translateX(-50%)",
        }}
      >
        <Button
          onClick={handleClick}
          pointerEvents="auto"
          size="sm"
          variant="outline"
          borderRadius="full"
          borderColor="border.muted"
          bg="bg.panel/60"
          color="fg"
          boxShadow="lg"
          backdropFilter="blur(20px) saturate(150%)"
          paddingX={4}
          gap={2}
          _hover={{ bg: "bg.panel/80", transform: "translateY(-1px)" }}
          aria-label={
            summary ? `Below the fold: ${summary}` : "Scroll to bottom"
          }
          maxWidth="min(540px, 90vw)"
        >
          <Icon as={LuChevronDown} boxSize={3.5} color="fg.muted" />
          <Text textStyle="xs" fontWeight="medium" truncate>
            {summary ?? "More below"}
          </Text>
        </Button>
      </Box>
    </Portal>
  );
}
