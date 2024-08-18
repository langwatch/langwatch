import { Box } from "@chakra-ui/react";
import { FunctionIcon } from "../../components/icons/FunctionIcon";

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
    >
      {icon}
    </Box>
  );
}

export function SignatureIcon() {
  return (
    <ColorfulBlockIcon color="green.400" size="md" icon={<FunctionIcon />} />
  );
}
