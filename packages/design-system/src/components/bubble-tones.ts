/** The colours of a conversation bubble, by who is speaking. */

export type BubbleTone = "user" | "assistant" | "error" | "system";

export interface BubblePalette {
  bg: string;
  fg: string;
  accent: string;
  avatarBg: string;
  avatarFg: string;
  selectedBg: string;
}

export const BUBBLE_TONES: Record<BubbleTone, BubblePalette> = {
  user: {
    bg: "blue.subtle",
    fg: "fg",
    accent: "blue.fg",
    avatarBg: "blue.muted",
    avatarFg: "blue.fg",
    selectedBg: "blue.subtle",
  },
  assistant: {
    bg: "bg.muted",
    fg: "fg",
    accent: "purple.fg",
    avatarBg: "purple.subtle",
    avatarFg: "purple.fg",
    selectedBg: "bg.muted",
  },
  error: {
    bg: "red.subtle",
    fg: "red.fg",
    accent: "red.fg",
    avatarBg: "red.muted",
    avatarFg: "red.fg",
    selectedBg: "red.subtle",
  },
  system: {
    bg: "bg.panel",
    fg: "fg.muted",
    accent: "fg.muted",
    avatarBg: "bg.muted",
    avatarFg: "fg.muted",
    selectedBg: "bg.panel",
  },
};
