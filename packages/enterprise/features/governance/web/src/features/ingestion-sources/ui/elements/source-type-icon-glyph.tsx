import type { SourceType } from "../../model/ingestion-source-catalog";
import type { ReactNode } from "react";
import {
  AnthropicIcon,
  AWSIcon,
  CustomIcon,
  DatabricksIcon,
  IconGlyph,
  MicrosoftIcon,
  OpenAIIcon,
  OpenTelemetryIcon,
  WorkatoIcon,
} from "@langwatch/design-system/icons";

const MONOCHROME_SOURCE_ICONS = new Set<SourceType>([
  "otel_generic",
  "claude_code",
  "claude_cowork",
  "claude_compliance",
  "anthropic_admin",
  "openai_compliance",
  "http_custom",
]);

const iconForSourceType = (sourceType: SourceType): ReactNode => {
  switch (sourceType) {
    case "otel_generic":
      return <OpenTelemetryIcon />;
    case "claude_code":
    case "claude_cowork":
    case "claude_compliance":
    case "anthropic_admin":
      return <AnthropicIcon />;
    case "workato":
      return <WorkatoIcon />;
    case "copilot_studio":
      return <MicrosoftIcon />;
    case "openai_compliance":
      return <OpenAIIcon />;
    case "databricks_genie":
      return <DatabricksIcon />;
    case "s3_custom":
      return <AWSIcon />;
    case "http_custom":
      return <CustomIcon />;
    // A source type added to the catalogue before it has a mark renders the
    // glyph's empty frame rather than nothing, so the row keeps its alignment.
    default:
      return null;
  }
};

export function SourceTypeIconGlyph({
  sourceType,
  size = "16px",
}: {
  sourceType: SourceType;
  size?: string | number;
}) {
  return (
    <IconGlyph
      icon={iconForSourceType(sourceType)}
      monochrome={MONOCHROME_SOURCE_ICONS.has(sourceType)}
      size={size}
    />
  );
}
