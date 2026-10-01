import { Box } from "@chakra-ui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const PRESS_FLASH_MS = 140;
const DEMO_FIRST_DELAY_MS = 1500;
const DEMO_INTERVAL_MS = 4000;

/**
 * Normalises an arbitrary Kbd label into the `event.key` we'd see when the
 * key is actually pressed. Only handles the small set of labels we use in
 * this codebase (single chars, named keys, modifier chords are not animated).
 */
function deriveKey(label: string): string | null {
  const trimmed = label.trim();
  if (!trimmed) return null;
  // Modifier chords ("Ctrl+/" etc.) — skip animation, too easy to misfire.
  if (trimmed.includes("+")) return null;
  const lower = trimmed.toLowerCase();
  switch (lower) {
    case "esc":
      return "Escape";
    case "enter":
    case "return":
      return "Enter";
    case "space":
      return " ";
    case "tab":
      return "Tab";
    case "↑":
      return "ArrowUp";
    case "↓":
      return "ArrowDown";
    case "←":
      return "ArrowLeft";
    case "→":
      return "ArrowRight";
    default:
      // Single-character labels match by case-insensitive event.key.
      return trimmed.length === 1 ? trimmed : null;
  }
}

function flattenChildrenToString(children: React.ReactNode): string {
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(flattenChildrenToString).join("");
  return "";
}

interface KbdProps {
  children: React.ReactNode;
  /**
   * When true, the key auto-presses itself on a loop after a short delay so
   * a reader who hasn't tried it yet still sees the flash - it stops as
   * soon as the reader presses the real key themselves.
   */
  demo?: boolean;
  /** Override the demo interval (ms between auto-presses). */
  demoEveryMs?: number;
  /** Delay before the very first demo press fires. Useful for staggering. */
  demoFirstDelayMs?: number;
}

const PRESSED_STYLE = {
  borderColor: "blue.solid",
  bg: "blue.subtle",
  color: "blue.fg",
  transform: "translateY(1px) scale(0.94)",
  boxShadow: "none",
} as const;

const RESTING_STYLE = {
  borderColor: "border",
  bg: "bg.surface",
  color: "fg.muted",
  transform: "translateY(0) scale(1)",
  boxShadow: "0 1px 0 var(--chakra-colors-border-muted)",
} as const;

function normaliseKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

/** A short "pressed" pulse, cleared on its own and on unmount. */
function useKeyFlash(): { pressed: boolean; flash: () => void } {
  const [pressed, setPressed] = useState(false);
  const flashTimeoutRef = useRef<number | null>(null);

  const flash = useCallback(() => {
    setPressed(true);
    if (flashTimeoutRef.current != null) {
      window.clearTimeout(flashTimeoutRef.current);
    }
    flashTimeoutRef.current = window.setTimeout(() => {
      setPressed(false);
      flashTimeoutRef.current = null;
    }, PRESS_FLASH_MS);
  }, []);

  useEffect(
    () => () => {
      if (flashTimeoutRef.current != null) {
        window.clearTimeout(flashTimeoutRef.current);
      }
    },
    [],
  );

  return { pressed, flash };
}

function useRealKeyPress({
  targetKey,
  onPress,
}: {
  targetKey: string | null;
  onPress: () => void;
}): void {
  useEffect(() => {
    if (!targetKey) return;
    const expected = normaliseKey(targetKey);
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (normaliseKey(e.key) !== expected) return;
      onPress();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [targetKey, onPress]);
}

/**
 * Self-demo loop: runs only while `active`. First press happens after a short
 * pause so the screen can settle, then it repeats every `everyMs`.
 */
function useDemoPresses({
  active,
  everyMs,
  firstDelayMs,
  flash,
}: {
  active: boolean;
  everyMs: number;
  firstDelayMs: number;
  flash: () => void;
}): void {
  useEffect(() => {
    if (!active) return;
    let intervalId: number | null = null;
    const firstId = window.setTimeout(() => {
      flash();
      intervalId = window.setInterval(flash, everyMs);
    }, firstDelayMs);
    return () => {
      window.clearTimeout(firstId);
      if (intervalId != null) window.clearInterval(intervalId);
    };
  }, [active, everyMs, firstDelayMs, flash]);
}

export function Kbd({
  children,
  demo = false,
  demoEveryMs = DEMO_INTERVAL_MS,
  demoFirstDelayMs = DEMO_FIRST_DELAY_MS,
}: KbdProps) {
  const [userPressed, setUserPressed] = useState(false);
  const { pressed, flash } = useKeyFlash();
  const targetKey = useMemo(() => deriveKey(flattenChildrenToString(children)), [children]);

  const onRealPress = useCallback(() => {
    setUserPressed(true);
    flash();
  }, [flash]);

  useRealKeyPress({ targetKey, onPress: onRealPress });
  useDemoPresses({
    active: demo && !userPressed,
    everyMs: demoEveryMs,
    firstDelayMs: demoFirstDelayMs,
    flash,
  });

  return (
    <Box
      as="kbd"
      display="inline-flex"
      alignItems="center"
      justifyContent="center"
      paddingX={1}
      height="15px"
      minWidth="15px"
      borderRadius="sm"
      border="1px solid"
      fontSize="2xs"
      fontFamily="mono"
      {...(pressed ? PRESSED_STYLE : RESTING_STYLE)}
      transition="transform 0.08s ease, background 0.12s ease, border-color 0.12s ease, color 0.12s ease, box-shadow 0.08s ease"
    >
      {children}
    </Box>
  );
}
