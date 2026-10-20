import { Box, VisuallyHidden } from "@chakra-ui/react";
import { useEffect, useState } from "react";

import { Kbd } from "./kbd.tsx";

export type ShortcutChord = {
  /** KeyboardEvent / ARIA key names, e.g. ["Control", "f"] or ["Shift", "Enter"]. */
  keys: readonly [string, ...string[]];
};

export type ShortcutDefinition = {
  alternatives: readonly [ShortcutChord, ...ShortcutChord[]];
  /** Spoken context, e.g. "While the find field is focused". */
  scopeLabel?: string;
};

export type ShortcutPlatform = "mac" | "other";

export type ShortcutHintProps = {
  shortcut: ShortcutDefinition;
  /** Explicit in stories and tests. Omitted, it is read after mount, never during render. */
  platform?: ShortcutPlatform;
  /** True inside a control that already has an accessible name: nothing is announced. */
  decorative?: boolean;
};

const MAC_GLYPHS: Record<string, string> = {
  Meta: "⌘",
  Control: "⌃",
  Alt: "⌥",
  Shift: "⇧",
};

const OTHER_LABELS: Record<string, string> = {
  Meta: "Win",
  Control: "Ctrl",
  Alt: "Alt",
  Shift: "Shift",
};

const SHARED_LABELS: Record<string, string> = {
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  Escape: "Esc",
  " ": "Space",
};

const SPOKEN: Record<string, string> = {
  Meta: "Command",
  Control: "Control",
  Alt: "Alt",
  Shift: "Shift",
  ArrowLeft: "Left arrow",
  ArrowRight: "Right arrow",
  ArrowUp: "Up arrow",
  ArrowDown: "Down arrow",
  Escape: "Escape",
  Enter: "Enter",
  " ": "Space",
  "?": "question mark",
  "\\": "backslash",
  "[": "left bracket",
  "]": "right bracket",
  "/": "slash",
  "+": "plus",
  "-": "minus",
  "=": "equals",
  "0": "0",
};

function displayKey({ key, platform }: { key: string; platform: ShortcutPlatform }): string {
  const modifier = platform === "mac" ? MAC_GLYPHS[key] : OTHER_LABELS[key];
  if (modifier) return modifier;
  const shared = SHARED_LABELS[key];
  if (shared) return shared;
  return key.length === 1 ? key.toUpperCase() : key;
}

function spokenKey({ key, platform }: { key: string; platform: ShortcutPlatform }): string {
  if (key === "Meta") return platform === "mac" ? "Command" : "Windows";
  const spoken = SPOKEN[key];
  if (spoken) return spoken;
  return key.length === 1 ? key.toUpperCase() : key;
}

function ariaKey(key: string): string {
  if (key === " ") return "Space";
  return key.length === 1 ? key.toLowerCase() : key;
}

/**
 * The value for `aria-keyshortcuts` on the real action element: every chord
 * the action supports, regardless of platform. It describes behaviour that
 * already exists; it never creates any.
 */
export function shortcutAriaKeys(shortcut: ShortcutDefinition): string {
  return shortcut.alternatives.map((chord) => chord.keys.map(ariaKey).join("+")).join(" ");
}

function modSignature(chord: ShortcutChord): string {
  return chord.keys.map((key) => (key === "Meta" || key === "Control" ? "Mod" : key)).join("+");
}

/** Cmd and Ctrl twins collapse to the one this platform uses; other alternatives all stay. */
function chordsForPlatform({
  shortcut,
  platform,
}: {
  shortcut: ShortcutDefinition;
  platform: ShortcutPlatform;
}): ShortcutChord[] {
  const preferred = platform === "mac" ? "Meta" : "Control";
  const chosen = new Map<string, ShortcutChord>();
  for (const chord of shortcut.alternatives) {
    const signature = modSignature(chord);
    const current = chosen.get(signature);
    if (!current || (chord.keys.includes(preferred) && !current.keys.includes(preferred))) {
      chosen.set(signature, chord);
    }
  }
  return [...chosen.values()];
}

function usePlatform(explicit: ShortcutPlatform | undefined): ShortcutPlatform {
  const [detected, setDetected] = useState<ShortcutPlatform>("other");
  useEffect(() => {
    if (explicit || typeof navigator === "undefined") return;
    setDetected(/mac|iphone|ipad/i.test(navigator.platform ?? "") ? "mac" : "other");
  }, [explicit]);
  return explicit ?? detected;
}

/**
 * A static keycap hint for a shortcut that already exists. It registers no
 * key, owns no focus stop and, unless decorative, reads as "Control plus F".
 */
export function ShortcutHint({ shortcut, platform, decorative = false }: ShortcutHintProps) {
  const resolved = usePlatform(platform);
  const chords = chordsForPlatform({ shortcut, platform: resolved });
  const spokenChords = chords
    .map((chord) => chord.keys.map((key) => spokenKey({ key, platform: resolved })).join(" plus "))
    .join(" or ");
  const spoken = shortcut.scopeLabel ? `${shortcut.scopeLabel}: ${spokenChords}` : spokenChords;

  return (
    <Box
      as="span"
      data-shortcut-hint=""
      display="inline-flex"
      alignItems="center"
      gap={1}
      flexShrink={0}
      whiteSpace="nowrap"
    >
      <Box as="span" aria-hidden="true" display="inline-flex" alignItems="center" gap={1}>
        {chords.map((chord, chordIndex) => (
          <Box
            as="span"
            key={chord.keys.join("+")}
            display="inline-flex"
            alignItems="center"
            gap={1}
          >
            {chordIndex > 0 ? (
              <Box as="span" textStyle="2xs" color="fg.subtle">
                or
              </Box>
            ) : null}
            {chord.keys.map((key, keyIndex) => (
              <Box as="span" key={`${key}-${keyIndex}`} display="inline-flex" gap={1}>
                {keyIndex > 0 ? (
                  <Box as="span" textStyle="2xs" color="fg.subtle">
                    +
                  </Box>
                ) : null}
                <Kbd interaction="static">{displayKey({ key, platform: resolved })}</Kbd>
              </Box>
            ))}
          </Box>
        ))}
      </Box>
      {decorative ? null : <VisuallyHidden>{spoken}</VisuallyHidden>}
    </Box>
  );
}
