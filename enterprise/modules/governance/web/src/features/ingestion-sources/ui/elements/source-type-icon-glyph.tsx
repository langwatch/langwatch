import type { SourceType } from "../../model/ingestion-source-catalog.ts";
import type { ReactNode } from "react";
import { Box } from "@chakra-ui/react";
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
  testId,
}: {
  sourceType: SourceType;
  size?: string | number;
  /**
   * Named by the caller rather than fixed here: this renders on the menu, the
   * composer, the list rows and the edit title, and one id shared by all of
   * them would make `getByTestId` ambiguous the first time two appear on one
   * screen. Callers that nothing queries pass nothing.
   *
   * Upstream (d4ea7c08bd, "Give IconGlyph a testId instead of wrapping it in
   * a span") puts this attribute on `IconGlyph`'s own root Box, because a
   * plain wrapping element becomes the flex item at this glyph's render
   * sites and swallows the glyph's `flexShrink: 0` / `inline-flex`.
   * `@langwatch/design-system`'s `IconGlyph` (packages/design-system/src/
   * components/icons/icon-glyph.tsx) does not take that prop yet and is
   * outside this port's writable scope, so this wraps with `display:
   * contents` instead of a plain span: the wrapper generates no box of its
   * own, so the glyph's Box stays the element the parent flex layout
   * measures. A design-system change adding `testId` to `IconGlyph` directly
   * would let this wrapper go.
   */
  testId?: string;
}) {
  const glyph = (
    <IconGlyph
      icon={iconForSourceType(sourceType)}
      monochrome={MONOCHROME_SOURCE_ICONS.has(sourceType)}
      size={size}
    />
  );
  if (!testId) return glyph;
  return (
    <Box display="contents" data-testid={testId}>
      {glyph}
    </Box>
  );
}
