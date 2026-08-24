import type { SourceType } from "@langwatch/enterprise-governance-web";
import type { ReactNode } from "react";
import { Anthropic } from "~/components/icons/Anthropic";
import { AWS } from "~/components/icons/AWS";
import { Custom } from "~/components/icons/Custom";
import { Databricks } from "~/components/icons/Databricks";
import { Microsoft } from "~/components/icons/Microsoft";
import { OpenAI } from "~/components/icons/OpenAI";
import { OpenTelemetry } from "~/components/icons/OpenTelemetry";
import { Workato } from "~/components/icons/Workato";
import { IconGlyph } from "~/components/ui/IconGlyph";

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
      return <OpenTelemetry />;
    case "claude_code":
    case "claude_cowork":
    case "claude_compliance":
    case "anthropic_admin":
      return <Anthropic />;
    case "workato":
      return <Workato />;
    case "copilot_studio":
      return <Microsoft />;
    case "openai_compliance":
      return <OpenAI />;
    case "databricks_genie":
      return <Databricks />;
    case "s3_custom":
      return <AWS />;
    case "http_custom":
      return <Custom />;
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
