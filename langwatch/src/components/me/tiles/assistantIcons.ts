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
  "codex",
  "gemini",
  "opencode",
  "cursor",
  "github_copilot",
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
    iconUrl: null,
    darkModeInvert: false,
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
};

export const ASSISTANT_OPTIONS: Array<{
  value: AssistantKind;
  label: string;
}> = [
  ...(Object.entries(ASSISTANT_PRESETS) as Array<[
    Exclude<AssistantKind, "custom">,
    AssistantPreset,
  ]>).map(([value, p]) => ({ value, label: p.label })),
  { value: "custom" as const, label: "Custom" },
];
