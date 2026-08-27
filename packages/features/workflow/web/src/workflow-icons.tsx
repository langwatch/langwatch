import { Box, type BoxProps } from "@chakra-ui/react";
import { useColorModeValue } from "@langwatch/design-system/color-mode";

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
