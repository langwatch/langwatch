import { chakra } from "@chakra-ui/react";
import { useEffect, useRef, useState } from "react";

/**
 * Letter-by-letter text, typeform style. Segments type in order; a segment
 * can ask for a pause after it ("Hello Rogerio [pause], I'm Langy [pause]").
 * The caret blinks while idle and disappears when the last segment lands.
 */
export interface TypeSegment {
  text: string;
  /** ms to hold after this segment before the next one types */
  pauseAfter?: number;
}

const blink = "typewriter-caret-blink";

export function Typewriter({
  segments,
  speed = 28,
  startDelay = 250,
  onDone,
}: {
  segments: TypeSegment[];
  /** ms per character */
  speed?: number;
  startDelay?: number;
  onDone?: () => void;
}) {
  // Code points, not UTF-16 units, so an emoji never types as a broken half.
  const chars = Array.from(segments.map((s) => s.text).join(""));
  const [count, setCount] = useState(0);
  const [done, setDone] = useState(false);
  const timers = useRef<number[]>([]);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  // Segment boundaries in character space, with their pauses.
  const key = segments.map((s) => `${s.text}|${s.pauseAfter ?? 0}`).join("¦");

  useEffect(() => {
    setCount(0);
    setDone(false);
    const pauses = new Map<number, number>();
    let at = 0;
    for (const seg of segments) {
      at += Array.from(seg.text).length;
      if (seg.pauseAfter) pauses.set(at, seg.pauseAfter);
    }
    const total = at;
    let i = 0;

    const tick = () => {
      i += 1;
      setCount(i);
      if (i >= total) {
        setDone(true);
        onDoneRef.current?.();
        return;
      }
      const pause = pauses.get(i) ?? 0;
      timers.current.push(window.setTimeout(tick, speed + pause));
    };
    timers.current.push(window.setTimeout(tick, startDelay));

    return () => {
      for (const t of timers.current) clearTimeout(t);
      timers.current = [];
    };
  }, [key, speed, startDelay]);

  return (
    <span data-typewriter-done={done ? "true" : "false"}>
      {chars.slice(0, count).join("")}
      <chakra.span
        aria-hidden
        display="inline-block"
        w="3px"
        ml="2px"
        borderRadius="2px"
        bg="currentColor"
        verticalAlign="baseline"
        opacity={done ? 0 : 1}
        animation={done ? undefined : `${blink} 1s ease-in-out infinite`}
        style={{ height: "0.9em", transform: "translateY(0.12em)" }}
      />
      <style>{`@keyframes ${blink} { 0%, 100% { opacity: 1 } 50% { opacity: 0.25 } }`}</style>
    </span>
  );
}
