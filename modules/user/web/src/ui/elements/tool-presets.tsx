/**
 * The built-in glyphs an internal-tool tile can wear.
 *
 * `platform/app` resolved these through `@langwatch/enterprise-governance-web`,
 * where the drawer that PICKS one lives. The portal only READS them, and a core
 * package reaching into an enterprise one to name six lucide icons is a worse
 * trade than six lucide icons: the contract already carries everything about a
 * tile that has meaning on the wire, and this is the part that has none.
 *
 * The stored form is what binds the two copies together — `preset:tool:<key>`
 * on `AiToolEntry.iconAsset` — so a key added on the authoring side and not
 * here renders the type's default glyph rather than a broken tile.
 */

import {
  BookOpen,
  Box,
  Globe,
  type LucideIcon,
  MessageSquare,
  Sparkles,
  Wrench,
} from "lucide-react";

const TOOL_PREFIX = "preset:tool:";

export const TOOL_KINDS = ["wrench", "globe", "book", "message", "box", "sparkles"] as const;

export type ToolKind = (typeof TOOL_KINDS)[number];

export const TOOL_PRESETS: Record<ToolKind, { label: string; Icon: LucideIcon }> = {
  wrench: { label: "Wrench", Icon: Wrench },
  globe: { label: "Globe", Icon: Globe },
  book: { label: "Book", Icon: BookOpen },
  message: { label: "Message", Icon: MessageSquare },
  box: { label: "Box", Icon: Box },
  sparkles: { label: "Sparkles", Icon: Sparkles },
};

/** The kind a stored `iconAsset` names, or null when it names something else. */
export function resolveToolPreset(value: string): ToolKind | null {
  if (!value.startsWith(TOOL_PREFIX)) return null;
  const key = value.slice(TOOL_PREFIX.length);
  return (TOOL_KINDS as readonly string[]).includes(key) ? (key as ToolKind) : null;
}
