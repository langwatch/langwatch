/**
 * Built-in preset icons for internal tool tiles.
 * Storage key format: `preset:tool:<key>`.
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
