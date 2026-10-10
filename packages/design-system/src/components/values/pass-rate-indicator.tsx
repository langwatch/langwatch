import { Circle, HStack, Text } from "@chakra-ui/react";

export const getPassRateGradientColor = (passRate: number | null): string => {
  if (passRate === null) {
    return "gray.400";
  }

  const rate = Math.max(0, Math.min(100, passRate));

  if (rate <= 50) {
    const t = rate / 50;
    const r = Math.round(239 + (245 - 239) * t);
    const g = Math.round(68 + (158 - 68) * t);
    const b = Math.round(68 + (11 - 68) * t);

    return `rgb(${r}, ${g}, ${b})`;
  }

  const t = (rate - 50) / 50;
  const r = Math.round(245 + (34 - 245) * t);
  const g = Math.round(158 + (197 - 158) * t);
  const b = Math.round(11 + (94 - 11) * t);

  return `rgb(${r}, ${g}, ${b})`;
};

type PassRateCircleProps = {
  passRate: number | null;
  size?: string;
};

export const PassRateCircle = ({ passRate, size = "10px" }: PassRateCircleProps) => (
  <Circle size={size} bg={getPassRateGradientColor(passRate)} flexShrink={0} />
);

type PassRateDisplayProps = {
  passRate: number | null;
  circleSize?: string;
  fontSize?: string;
  showColoredText?: boolean;
};

export const PassRateDisplay = ({
  passRate,
  circleSize = "10px",
  fontSize = "12px",
  showColoredText = true,
}: PassRateDisplayProps) => (
  <HStack gap={1.5}>
    <PassRateCircle passRate={passRate} size={circleSize} />
    <Text
      fontSize={fontSize}
      fontWeight="medium"
      color={showColoredText ? getPassRateGradientColor(passRate) : undefined}
    >
      {passRate === null ? "-" : `${Math.round(passRate)}%`}
    </Text>
  </HStack>
);
