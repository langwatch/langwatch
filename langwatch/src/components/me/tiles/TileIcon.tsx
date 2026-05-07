import { Box, Image } from "@chakra-ui/react";
import { Bot, Boxes, Wrench } from "lucide-react";
import type { ReactNode } from "react";

import { modelProviderIcons } from "../../../server/modelProviders/iconsMap";

import {
  ASSISTANT_PRESETS,
  type AssistantKind,
} from "./assistantIcons";
import type { AiToolTileType } from "./types";

const FALLBACK_ICONS: Record<AiToolTileType, ReactNode> = {
  coding_assistant: <Bot size={18} />,
  model_provider: <Boxes size={18} />,
  external_tool: <Wrench size={18} />,
};

const PRESET_PREFIX = "preset:";
const DATA_URL_PREFIX = "data:";

interface ResolvedAsset {
  url: string;
  darkModeInvert: boolean;
}

function resolveIconAsset(value: string): ResolvedAsset | null {
  if (value.startsWith(DATA_URL_PREFIX)) {
    return { url: value, darkModeInvert: false };
  }
  if (value.startsWith(PRESET_PREFIX)) {
    const key = value.slice(PRESET_PREFIX.length) as AssistantKind;
    if (key === "custom") return null;
    const preset = ASSISTANT_PRESETS[key];
    if (!preset?.iconUrl) return null;
    return { url: preset.iconUrl, darkModeInvert: preset.darkModeInvert };
  }
  return null;
}

export function TileIcon({
  iconAsset,
  iconKey,
  type,
  size = 28,
}: {
  /**
   * Prefix-discriminated icon source (preset:<kind> | data:image/...).
   * Preferred over the legacy `iconKey` lookup; falls through if null.
   */
  iconAsset?: string | null;
  /** Legacy preset-key lookup (modelProviderIcons map). */
  iconKey?: string | null;
  type: AiToolTileType;
  size?: number;
}) {
  const resolved = iconAsset ? resolveIconAsset(iconAsset) : null;

  let inner: ReactNode;
  if (resolved) {
    inner = (
      <Image
        src={resolved.url}
        alt=""
        width={`${size - 8}px`}
        height={`${size - 8}px`}
        objectFit="contain"
        _dark={
          resolved.darkModeInvert
            ? { filter: "invert(1) hue-rotate(180deg)" }
            : undefined
        }
      />
    );
  } else if (iconKey) {
    const brand =
      modelProviderIcons[iconKey as keyof typeof modelProviderIcons];
    inner = brand ?? FALLBACK_ICONS[type];
  } else {
    inner = FALLBACK_ICONS[type];
  }

  return (
    <Box
      width={`${size}px`}
      height={`${size}px`}
      flexShrink={0}
      display="flex"
      alignItems="center"
      justifyContent="center"
      color="fg.muted"
      borderRadius="sm"
      backgroundColor="bg.subtle"
      padding={1}
    >
      {inner}
    </Box>
  );
}
