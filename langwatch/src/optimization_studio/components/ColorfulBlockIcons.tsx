import { Box, type BoxProps } from "@chakra-ui/react";
import {
  BookOpen,
  Box as BoxIcon,
  Check,
  Code,
  Flag,
  Home,
  Shield,
} from "react-feather";
import { EqualsIcon } from "../../components/icons/EqualsIcon";
import { LLMIcon } from "../../components/icons/LLMIcon";
import { WeaviateIcon } from "../../components/icons/WeaviateIcon";
import type { ComponentType } from "../types/dsl";

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

export function ColorfulBlockIcon({
  color,
  size,
  icon,
  ...props
}: {
  color: string;
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
      backgroundColor={color}
      borderRadius="4px"
      fontSize={fontSizeMap[size]}
      display="flex"
      alignItems="center"
      justifyContent="center"
      color="white"
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

export function EvaluatorIcon({ cls }: { cls?: string }) {
  const iconMap: Record<string, React.ReactNode> = {
    ExactMatchEvaluator: <EqualsIcon />,
    "azure/prompt_injection": <Shield />,
    "openai/moderation": <Shield />,
  };

  if (!iconMap[cls ?? ""]) {
    return <Check />;
  }
  return iconMap[cls ?? ""];
}

export function RetrieverIcon({ cls }: { cls?: string }) {
  const iconMap: Record<string, React.ReactNode> = {
    WeaviateRM: <WeaviateIcon />,
  };

  if (!iconMap[cls ?? ""]) {
    return <BookOpen />;
  }
  return iconMap[cls ?? ""];
}

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
  const componentIconMap: Record<ComponentType, React.ReactNode> = {
    signature: <LLMIcon />,
    entry: <Home />,
    code: <Code />,
    retriever: <RetrieverIcon cls={cls} />,
    prompting_technique: <BoxIcon />,
    evaluator: <EvaluatorIcon cls={cls} />,
    end: <Flag />,
    custom: <BoxIcon />,
  };

  const componentColorMap: Record<ComponentType, string> = {
    signature: "green.emphasized",
    entry: "blue.emphasized",
    code: "cyan.emphasized",
    retriever: "purple.emphasized",
    prompting_technique: "teal.emphasized",
    evaluator: "green.emphasized",
    end: "orange.emphasized",
    custom: "gray.emphasized",
  };

  let color = componentColorMap[type];
  if (behave_as === "evaluator") {
    color = "green.solid";
  }

  return (
    <ColorfulBlockIcon
      color={color}
      size={size}
      icon={componentIconMap[type]}
    />
  );
};

export function WorkflowIcon({
  icon,
  size,
}: {
  icon: React.ReactNode;
  size: "xs" | "md" | "lg";
}) {
  const reactflowBg = `<svg width="6" height="6" viewBox="0 0 6 6" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="6" height="6" fill="#F2F4F8"/>
  <rect x="3" y="3" width="2" height="2" fill="#E5E7EB"/>
  </svg>
  `;

  return (
    <Box
      background={`url('data:image/svg+xml;utf8,${encodeURIComponent(
        reactflowBg,
      )}')`}
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
    >
      {icon}
    </Box>
  );
}
