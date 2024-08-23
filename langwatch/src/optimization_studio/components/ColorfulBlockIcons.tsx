import { Box } from "@chakra-ui/react";
import { FunctionIcon } from "../../components/icons/FunctionIcon";
import { Home } from "react-feather";
import type { ComponentType } from "../types/dsl";

export function ColorfulBlockIcon({
  color,
  size,
  icon,
}: {
  color: string;
  size: "sm" | "md" | "lg";
  icon: React.ReactNode;
}) {
  const sizeMap = {
    sm: "16px",
    md: "24px",
    lg: "32px",
  };
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
