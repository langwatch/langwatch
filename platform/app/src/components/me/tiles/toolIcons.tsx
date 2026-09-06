import {
  BookOpen,
  Box,
  Globe,
  type LucideIcon,
  MessageSquare,
  Sparkles,
  Wrench,
} from "lucide-react";

/**
 * Default lucide presets for internal-tool tiles. The drawer surfaces
 * these as a horizontal picker before the Upload button — most admins
 * pick a built-in glyph; only the rare bespoke tool needs a custom
 * upload (rchaves bug-bash spec: "we could offer them a few default
 * options to chose from before uploading their own").
 *
 * Stored as `preset:tool:<key>` on AiToolEntry.iconAsset and resolved
 * back to the lucide ReactNode in TileIcon.
 */
export const TOOL_KINDS = [
  "wrench",
  "globe",
  "book",
  "message",
  "box",
  "sparkles",
] as const;

export type ToolKind = (typeof TOOL_KINDS)[number];

export const TOOL_PRESETS: Record<
  ToolKind,
  { label: string; Icon: LucideIcon }
> = {
  wrench: { label: "Wrench", Icon: Wrench },
  globe: { label: "Globe", Icon: Globe },
  book: { label: "Book", Icon: BookOpen },
  message: { label: "Message", Icon: MessageSquare },
  box: { label: "Box", Icon: Box },
  sparkles: { label: "Sparkles", Icon: Sparkles },
};

export const DEFAULT_TOOL_KIND: ToolKind = "wrench";

const TOOL_PREFIX = "preset:tool:";

export function isToolPresetAsset(value: string): boolean {
  return value.startsWith(TOOL_PREFIX);
}

export function resolveToolPreset(value: string): ToolKind | null {
  if (!value.startsWith(TOOL_PREFIX)) return null;
  const key = value.slice(TOOL_PREFIX.length);
  return (TOOL_KINDS as readonly string[]).includes(key)
    ? (key as ToolKind)
    : null;
}

export function toolPresetAsset(kind: ToolKind): string {
  return `${TOOL_PREFIX}${kind}`;
}
