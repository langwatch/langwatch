import { Box } from "@chakra-ui/react";
import { FunctionIcon } from "../../components/icons/FunctionIcon";
import { Home } from "react-feather";
import type { ComponentType } from "../types/dsl";

const sizeMap = {
  sm: "16px",
  md: "24px",
  lg: "32px",
};

export function ColorfulBlockIcon({
  color,
  size,
  icon,
}: {
  color: string;
  size: "sm" | "md" | "lg";
  icon: React.ReactNode;
}) {
  const paddingMap = {
    sm: "2px",
    md: "3px",
    lg: "3px",
  };

  return (
    <Box
      backgroundColor={color}
      borderRadius="4px"
      padding={paddingMap[size]}
      width={sizeMap[size]}
      height={sizeMap[size]}
      display="flex"
      alignItems="center"
      justifyContent="center"
      color="white"
    >
      {icon}
    </Box>
  );
}

export const ComponentIcon = ({
  type,
  size,
}: {
  type: ComponentType;
  size: "sm" | "md" | "lg";
}) => {
  const componentIconMap: Record<ComponentType, React.ReactNode> = {
    signature: <FunctionIcon />,
    entry: <Home />,
    module: <Box />,
    retriever: <Box />,
    prompting_technique: <Box />,
    evaluator: <Box />,
  };

  const componentColorMap: Record<ComponentType, string> = {
    signature: "green.400",
    entry: "blue.400",
    module: "gray.400",
    retriever: "gray.400",
    prompting_technique: "gray.400",
    evaluator: "gray.400",
  };

  return (
    <ColorfulBlockIcon
      color={componentColorMap[type]}
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
  size: "sm" | "md" | "lg";
}) {
  const reactflowBg = `<svg width="6" height="6" viewBox="0 0 6 6" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="6" height="6" fill="#F2F4F8"/>
  <rect x="3" y="3" width="2" height="2" fill="#E5E7EB"/>
  </svg>
  `;

  return (
    <Box
      background={`url('data:image/svg+xml;utf8,${encodeURIComponent(
        reactflowBg
      )}')`}
      borderRadius="4px"
      border="1px solid"
      borderColor="gray.200"
      width={sizeMap[size]}
      height={sizeMap[size]}
      display="flex"
      alignItems="center"
      justifyContent="center"
      color="white"
    >
      {icon}
    </Box>
  );
}
