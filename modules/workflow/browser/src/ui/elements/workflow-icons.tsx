import { useColorModeValue } from "@langwatch/design-system/color-mode";
import { WeaviateIcon } from "@langwatch/design-system/icons";
import { Box, type BoxProps } from "@langwatch/design-system/primitives";
import type { ComponentType, SourceType } from "@langwatch/workflow-contract";
import {
  BookOpen,
  Bot,
  Box as BoxIcon,
  CodeXml,
  Database,
  Equal,
  Flag,
  GitBranch,
  Globe,
  type LucideIcon,
  MessageSquareText,
  Play,
  Shield,
  Sparkles,
  SquareCheck,
} from "lucide-react";

const sizeMap = {
  xs: "16px",
  sm: "20px",
  md: "24px",
  lg: "28px",
  xl: "32px",
};

const fontSizeMap = {
  xs: "12px",
  sm: "13px",
  md: "16px",
  lg: "18px",
  xl: "20px",
};

/** A node-kind tile: `colorPalette` tokens, after identity-provider-tile.tsx:72. */
export function ColorfulBlockIcon({
  colorPalette,
  size,
  icon,
  ...props
}: {
  colorPalette: StudioPalette;
  size: "xs" | "sm" | "md" | "lg" | "xl";
  icon: React.ReactNode;
} & BoxProps) {
  const paddingMap = {
    xs: "2px",
    sm: "3px",
    md: "3px",
    lg: "4px",
    xl: "4px",
  };

  return (
    <Box
      colorPalette={colorPalette}
      backgroundColor="colorPalette.solid"
      borderRadius="4px"
      fontSize={fontSizeMap[size]}
      display="flex"
      alignItems="center"
      justifyContent="center"
      color="colorPalette.contrast"
      _icon={{
        padding: paddingMap[size],
        minWidth: sizeMap[size],
        minHeight: sizeMap[size],
        maxWidth: sizeMap[size],
        maxHeight: sizeMap[size],
      }}
      {...props}
    >
      {icon}
    </Box>
  );
}

export function WorkflowIcon({
  icon,
  size,
  ...props
}: {
  icon: React.ReactNode;
  size: "xs" | "md" | "lg";
} & BoxProps) {
  const bgColor = useColorModeValue("#F2F4F8", "#19191d");
  const dotColor = useColorModeValue("#E5E7EB", "#2e3038");
  const reactflowBg = `<svg width="6" height="6" viewBox="0 0 6 6" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="6" height="6" fill="${bgColor}"/>
  <rect x="3" y="3" width="2" height="2" fill="${dotColor}"/>
</svg>`;

  return (
    <Box
      background={`url('data:image/svg+xml;utf8,${encodeURIComponent(reactflowBg)}')`}
      borderRadius="4px"
      border="1px solid"
      borderColor="border"
      width={sizeMap[size]}
      minWidth={sizeMap[size]}
      height={sizeMap[size]}
      minHeight={sizeMap[size]}
      display="flex"
      alignItems="center"
      justifyContent="center"
      color="white"
      fontSize={fontSizeMap[size]}
      {...props}
    >
      {icon}
    </Box>
  );
}

type StudioPalette =
  | "blue"
  | "purple"
  | "cyan"
  | "orange"
  | "pink"
  | "green"
  | "teal"
  | "yellow"
  | "gray";

/** The one map of node kind to icon and palette; studio surfaces read it via ComponentIcon. */
const STUDIO_NODE_KINDS: Record<ComponentType, { icon: LucideIcon; palette: StudioPalette }> = {
  signature: { icon: MessageSquareText, palette: "blue" },
  code: { icon: CodeXml, palette: "purple" },
  http: { icon: Globe, palette: "cyan" },
  if_else: { icon: GitBranch, palette: "orange" },
  agent: { icon: Bot, palette: "pink" },
  evaluator: { icon: SquareCheck, palette: "green" },
  retriever: { icon: BookOpen, palette: "teal" },
  prompting_technique: { icon: Sparkles, palette: "yellow" },
  entry: { icon: Play, palette: "gray" },
  end: { icon: Flag, palette: "gray" },
  custom: { icon: BoxIcon, palette: "gray" },
};

const CLASS_ICONS: Record<string, React.ReactNode> = {
  ExactMatchEvaluator: <Equal />,
  "azure/prompt_injection": <Shield />,
  "openai/moderation": <Shield />,
  WeaviateRM: <WeaviateIcon />,
};

export const ComponentIcon = ({
  type,
  cls,
  size,
  behave_as,
}: {
  type: ComponentType;
  cls?: string;
  size: "xs" | "md" | "lg";
  behave_as?: "evaluator";
}) => {
  const kind = STUDIO_NODE_KINDS[behave_as ?? type];
  const Icon = STUDIO_NODE_KINDS[type].icon;
  const icon = CLASS_ICONS[cls ?? ""] ?? <Icon />;

  return <ColorfulBlockIcon colorPalette={kind.palette} size={size} icon={icon} />;
};

/** A variable source's icon, for the prompt kit's `renderSourceIcon` prop. */
export function renderSourceTypeIcon(type: SourceType): React.ReactNode {
  if (type === "dataset") {
    return <ColorfulBlockIcon colorPalette="blue" size="xs" icon={<Database />} />;
  }
  return <ComponentIcon type={type} size="xs" />;
}
