/**
 * Catalog of supported coding-assistant kinds + their preset icon shapes.
 * Used by the Tool Catalog admin drawer (fixed-list picker + preview) and
 * the user-facing CodingAssistantTile (icon resolution).
 *
 * Mirrors the CLI wrapper list (specs/ai-gateway/governance/cli-wrappers.feature):
 * Claude Code, Codex, Gemini, Open Code, Cursor — anything outside this
 * list goes through the `custom` slot which accepts an admin-uploaded
 * SVG/PNG (stored as base64 on AiToolEntry.iconAsset).
 */
export const ASSISTANT_KINDS = [
  "claude_code",
  "claude_cowork",
  "codex",
  "gemini",
  "opencode",
  "cursor",
  "github_copilot",
  "pi",
  "custom",
] as const;

export type AssistantKind = (typeof ASSISTANT_KINDS)[number];

interface AssistantPreset {
  label: string;
  iconUrl: string | null;
  /**
   * When true, apply CSS `filter: invert(1) hue-rotate(180deg)` in dark
   * mode — for monochrome black-on-transparent icons that vanish on
   * dark backgrounds. Brand-colored icons (orange/gradient) leave this
   * false; their colors are visible in both modes.
   */
  darkModeInvert: boolean;
}

export const ASSISTANT_PRESETS: Record<
  Exclude<AssistantKind, "custom">,
  AssistantPreset
> = {
  claude_code: {
    label: "Claude Code",
    iconUrl: "/images/external-icons/claude-code.svg",
    darkModeInvert: false,
  },
  // Same brand mark as Claude Code — Cowork is the desktop runtime of the
  // same product family, and no separate icon asset exists for it.
  claude_cowork: {
    label: "Claude Cowork",
    iconUrl: "/images/external-icons/claude-code.svg",
    darkModeInvert: false,
  },
  codex: {
    label: "Codex",
    iconUrl: "/images/external-icons/codex.svg",
    darkModeInvert: false,
  },
  gemini: {
    label: "Gemini",
    iconUrl: "/images/external-icons/gemini.svg",
    darkModeInvert: false,
  },
  opencode: {
    label: "Open Code",
    iconUrl: "/images/external-icons/opencode.svg",
    darkModeInvert: true,
  },
  cursor: {
    label: "Cursor",
    iconUrl: "/images/external-icons/cursor.svg",
    darkModeInvert: true,
  },
  github_copilot: {
    label: "GitHub Copilot",
    iconUrl: "/images/external-icons/github-copilot.svg",
    darkModeInvert: true,
  },
  // No icon asset: we hold no pi mark we are licensed to redistribute, and
  // inventing one would ship a fake logo. `iconUrl: null` is the supported
  // no-asset state — TileIcon and the drawer preview both fall through to the
  // neutral coding-assistant glyph. Swap in a real asset (with its licence
  // recorded here) if one is ever obtained. ADR-132.
  pi: {
    label: "pi",
    iconUrl: null,
    darkModeInvert: false,
  },
};

export const ASSISTANT_OPTIONS: Array<{
  value: AssistantKind;
  label: string;
}> = [
  ...(
    Object.entries(ASSISTANT_PRESETS) as Array<
      [Exclude<AssistantKind, "custom">, AssistantPreset]
    >
  ).map(([value, p]) => ({ value, label: p.label })),
  { value: "custom" as const, label: "Custom" },
];
