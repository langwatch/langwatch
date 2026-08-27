import { Bot } from "lucide-react";
import {
  BookOpen,
  Box as BoxIcon,
  Check,
  Code,
  Flag,
  GitBranch,
  Globe,
  Home,
  Shield,
} from "react-feather";
import { EqualsIcon } from "../../components/icons/EqualsIcon";
import { LLMIcon } from "../../components/icons/LLMIcon";
import { WeaviateIcon } from "../../components/icons/WeaviateIcon";
import { ColorfulBlockIcon } from "@langwatch/workflow-web";
import type { ComponentType } from "@langwatch/workflow-contract";

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
    http: <Globe />,
    agent: <Bot size={16} />,
    retriever: <RetrieverIcon cls={cls} />,
    prompting_technique: <BoxIcon />,
    evaluator: <EvaluatorIcon cls={cls} />,
    end: <Flag />,
    custom: <BoxIcon />,
    if_else: <GitBranch />,
  };

  const componentColorMap: Record<ComponentType, string> = {
    signature: "green.emphasized",
    entry: "blue.emphasized",
    code: "cyan.emphasized",
    http: "orange.emphasized",
    agent: "purple.emphasized",
    retriever: "purple.emphasized",
    prompting_technique: "teal.emphasized",
    evaluator: "green.emphasized",
    end: "orange.emphasized",
    custom: "gray.emphasized",
    if_else: "yellow.emphasized",
  };

  let color = componentColorMap[type];
  if (behave_as === "evaluator") {
    color = "green.solid";
  }

  return <ColorfulBlockIcon color={color} size={size} icon={componentIconMap[type]} />;
};
