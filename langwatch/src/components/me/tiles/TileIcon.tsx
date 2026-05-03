import { Box } from "@chakra-ui/react";
import { Bot, Boxes, Wrench } from "lucide-react";
import type { ReactNode } from "react";

import { modelProviderIcons } from "../../../server/modelProviders/iconsMap";

import type { AiToolTileType } from "./types";

const FALLBACK_ICONS: Record<AiToolTileType, ReactNode> = {
  coding_assistant: <Bot size={18} />,
  model_provider: <Boxes size={18} />,
  external_tool: <Wrench size={18} />,
};

export function TileIcon({
  iconKey,
  type,
  size = 28,
}: {
  iconKey?: string | null;
  type: AiToolTileType;
  size?: number;
}) {
  const brand = iconKey
    ? modelProviderIcons[iconKey as keyof typeof modelProviderIcons]
    : undefined;
  const node = brand ?? FALLBACK_ICONS[type];

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
      {node}
    </Box>
  );
}
