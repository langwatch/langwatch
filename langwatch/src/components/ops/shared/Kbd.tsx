import { Box } from "@chakra-ui/react";
import { useEffect, useMemo, useState } from "react";

const PRESS_FLASH_MS = 140;

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

export function Kbd({ children }: { children: React.ReactNode }) {
  const [pressed, setPressed] = useState(false);
  const targetKey = useMemo(() => {
    const label = flattenChildrenToString(children);
    return deriveKey(label);
  }, [children]);

  useEffect(() => {
    if (!targetKey) return;
    const expected = targetKey.length === 1 ? targetKey.toLowerCase() : targetKey;
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const got = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (got !== expected) return;
      setPressed(true);
      window.setTimeout(() => setPressed(false), PRESS_FLASH_MS);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [targetKey]);

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
      borderColor={pressed ? "blue.solid" : "border"}
      bg={pressed ? "blue.subtle" : "bg.surface"}
      fontSize="2xs"
      fontFamily="mono"
      color={pressed ? "blue.fg" : "fg.muted"}
      transform={pressed ? "translateY(1px) scale(0.94)" : "translateY(0) scale(1)"}
      boxShadow={pressed ? "none" : "0 1px 0 var(--chakra-colors-border-muted)"}
      transition="transform 0.08s ease, background 0.12s ease, border-color 0.12s ease, color 0.12s ease, box-shadow 0.08s ease"
    >
      {children}
    </Box>
  );
}
