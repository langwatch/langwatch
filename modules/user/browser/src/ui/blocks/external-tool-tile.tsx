import { Card } from "@langwatch/design-system/card";
import { Box, Button, IconButton, VStack } from "@langwatch/design-system/primitives";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { useState } from "react";

import type { AiToolConfigOf } from "../../model/ai-tool-config.ts";
import { TileIcon } from "../elements/tile-icon.tsx";
import { ToolMarkdown } from "../elements/tool-markdown.tsx";

interface Props {
  displayName: string;
  config: AiToolConfigOf<"external_tool">;
  iconAsset?: string | null;
  iconKey?: string | null;
}

export function ExternalToolTile({ displayName, config, iconAsset, iconKey }: Props) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card
      titleLevel={3}
      icon={<TileIcon iconAsset={iconAsset} iconKey={iconKey} type="external_tool" />}
      title={displayName}
      description="Internal tool"
      actions={
        <IconButton
          size="xs"
          variant="ghost"
          aria-expanded={expanded}
          aria-label={`${expanded ? "Hide" : "Show"} details for ${displayName}`}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </IconButton>
      }
    >
      {expanded ? (
        <VStack align="stretch" gap={3}>
          <Box fontSize="sm" color="fg.default" css={{ "& p": { marginBottom: "0.5rem" } }}>
            <ToolMarkdown>{config.descriptionMarkdown}</ToolMarkdown>
          </Box>
          <Button size="sm" variant="outline" asChild alignSelf="start">
            <a href={config.linkUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={14} /> {config.ctaLabel ?? `Open ${displayName}`}
            </a>
          </Button>
        </VStack>
      ) : null}
    </Card>
  );
}
