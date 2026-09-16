// Catalog of supported coding-assistant kinds and preset icon shapes;
// mirrors CLI wrapper list; others use custom icon slot.
export const ASSISTANT_KINDS = [
  "claude_code",
  "claude_cowork",
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
   * When true, apply CSS `filter: invert(1) hue-rotate(180deg)` in dark mode
   * — for monochrome black-on-transparent icons that vanish on dark
   * backgrounds. Brand-colored icons leave this false; visible in both modes.
   */
  darkModeInvert: boolean;
}

export const ASSISTANT_PRESETS: Record<Exclude<AssistantKind, "custom">, AssistantPreset> = {
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
};

export const ASSISTANT_OPTIONS: {
  value: AssistantKind;
  label: string;
}[] = [
  ...(
    Object.entries(ASSISTANT_PRESETS) as [Exclude<AssistantKind, "custom">, AssistantPreset][]
  ).map(([value, p]) => ({ value, label: p.label })),
  { value: "custom" as const, label: "Custom" },
];
