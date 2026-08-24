import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import { MONO_FONT } from "../logic/brand";

/**
 * The product, arguing for itself with the only data it is allowed to have:
 * this page.
 *
 * The headline above claims you will see what your agents are actually doing.
 * A screenshot would be a claim about that claim. This is the thing itself —
 * a span list of what this browser just did, assembled as it happens, in the
 * shape the trace drawer draws.
 *
 * It is a copy of the span view's LANGUAGE, not of the span view. The real one
 * reads through tRPC queries that need a session, and the front door
 * deliberately has none; importing it would tie the signed-out page to the
 * authenticated data layer for the sake of a resemblance.
 *
 * Three rules it does not break:
 *
 *   - nothing leaves this browser. There is no fetch here, no beacon, no
 *     analytics call and no store: the spans live in a React state array and
 *     are gone when the page is. Quietly recording what an unauthenticated
 *     visitor does, on a page about observability, would be the exact thing
 *     the product exists to make visible.
 *   - it never competes with the form. It sits on the far side of the card, it
 *     is small and muted, and it caps at the most recent handful so it cannot
 *     grow into the layout.
 *   - reduced motion gets what already happened and no live appending: the
 *     page's own load timings, rendered once and left alone.
 */

/** What a row is: the drawer's columns, minus everything needing a server. */
interface DemoSpan {
  id: number;
  name: string;
  /** Rendered to the right, the way a duration column reads. */
  value: string;
  /** One level of indent, for a span that belongs to the one above it. */
  nested?: boolean;
}

/** Enough to read as a trace, few enough never to reflow the panel. */
const MAX_ROWS = 7;

/** Interactions land at most this often, so a dragged pointer is one row. */
const THROTTLE_MS = 220;

export function FrontDoorTraceDemo() {
  const spans = useDemoSpans();
  if (spans.length === 0) return null;

  return (
    <VStack
      align="stretch"
      gap="3px"
      width="full"
      fontFamily={MONO_FONT}
      fontSize="11.5px"
      color="fg.muted"
      data-testid="front-door-trace-demo"
      // Decorative: it demonstrates, it does not inform. A screen reader
      // working through a sign-up form does not need a live span feed.
      aria-hidden="true"
    >
      {spans.map((span) => (
        <DemoRow key={span.id} span={span} />
      ))}
      <Text paddingTop="6px" fontSize="10.5px" opacity={0.5}>
        every span on this page — nothing left this browser
      </Text>
    </VStack>
  );
}

function DemoRow({ span }: { span: DemoSpan }) {
  return (
    <HStack justify="space-between" gap={4}>
      <HStack gap="6px" minWidth={0}>
        <Box
          as="span"
          opacity={0.45}
          paddingInlineStart={span.nested ? "14px" : 0}
        >
          ▸
        </Box>
        <Text truncate>{span.name}</Text>
      </HStack>
      <Text flexShrink={0} opacity={0.6}>
        {span.value}
      </Text>
    </HStack>
  );
}

/** The collection, kept out of the component so the render stays a render. */
function useDemoSpans(): DemoSpan[] {
  const reduceMotion = useReducedMotion();
  const [spans, setSpans] = useState<DemoSpan[]>([]);
  const nextId = useRef(0);
  const lastAt = useRef(0);

  const push = useCallback((span: Omit<DemoSpan, "id">) => {
    setSpans((rows) =>
      [...rows, { ...span, id: nextId.current++ }].slice(-MAX_ROWS),
    );
  }, []);

  // The page's own load, read from timings the browser already took. Nothing
  // is measured for this — it happened before the component mounted.
  useEffect(() => {
    const [navigation] = performance.getEntriesByType(
      "navigation",
    ) as PerformanceNavigationTiming[];
    if (navigation) {
      push({
        name: "page.load",
        value: `${Math.round(navigation.duration)}ms`,
      });
      push({
        name: "dom.interactive",
        value: `${Math.round(navigation.domInteractive)}ms`,
        nested: true,
      });
    }
    let cancelled = false;
    void document.fonts?.ready.then(() => {
      if (cancelled) return;
      push({
        name: "fonts.ready",
        value: `${Math.round(performance.now())}ms`,
        nested: true,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [push]);

  // Live interactions: passive listeners, throttled, torn down with the
  // component. Nothing is retained anywhere else.
  useEffect(() => {
    if (reduceMotion) return;

    const record = (name: string) => {
      const now = performance.now();
      if (now - lastAt.current < THROTTLE_MS) return;
      const sinceLast = lastAt.current === 0 ? 0 : now - lastAt.current;
      lastAt.current = now;
      push({ name, value: `+${Math.round(sinceLast)}ms` });
    };

    const onFocus = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null;
      const field =
        target?.getAttribute("type") ?? target?.tagName.toLowerCase();
      if (field) record(`field.focus ${field}`);
    };
    const onInput = () => record("input.change");
    const onPointer = () => record("pointer.move");
    const onKey = () => record("key.press");

    document.addEventListener("focusin", onFocus, { passive: true });
    document.addEventListener("input", onInput, { passive: true });
    document.addEventListener("pointermove", onPointer, { passive: true });
    document.addEventListener("keydown", onKey, { passive: true });
    return () => {
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("input", onInput);
      document.removeEventListener("pointermove", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [reduceMotion, push]);

  return spans;
}
