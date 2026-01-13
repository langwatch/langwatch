/**
 * PassRateIndicator - Visual indicator for pass rate percentage.
 *
 * Shared between Evaluations V3 and Batch Results.
 */
import { Circle, HStack, Text } from "@chakra-ui/react";

/**
 * Get a color that interpolates from red (0%) to orange (50%) to green (100%)
 * based on the pass rate percentage.
 */
export const getPassRateGradientColor = (passRate: number): string => {
  // Clamp to 0-100
  const rate = Math.max(0, Math.min(100, passRate));

  if (rate <= 50) {
    // Red to Orange: 0% = red, 50% = orange
    // Red: rgb(239, 68, 68) -> Orange: rgb(245, 158, 11)
    const t = rate / 50;
    const r = Math.round(239 + (245 - 239) * t);
    const g = Math.round(68 + (158 - 68) * t);
    const b = Math.round(68 + (11 - 68) * t);
    return `rgb(${r}, ${g}, ${b})`;
  } else {
    // Orange to Green: 50% = orange, 100% = green
    // Orange: rgb(245, 158, 11) -> Green: rgb(34, 197, 94)
    const t = (rate - 50) / 50;
    const r = Math.round(245 + (34 - 245) * t);
    const g = Math.round(158 + (197 - 158) * t);
    const b = Math.round(11 + (94 - 11) * t);
    return `rgb(${r}, ${g}, ${b})`;
  }
};

type PassRateCircleProps = {
  /** Pass rate as percentage (0-100) */
  passRate: number;
  /** Size of the circle (default: "10px") */
  size?: string;
};

/**
 * Colored circle indicator for pass rate.
 * Color interpolates from red (0%) through orange (50%) to green (100%).
 */
export const PassRateCircle = ({
  passRate,
  size = "10px",
}: PassRateCircleProps) => (
  <Circle size={size} bg={getPassRateGradientColor(passRate)} flexShrink={0} />
);

type PassRateDisplayProps = {
  /** Pass rate as percentage (0-100) */
  passRate: number;
  /** Size of the circle */
  circleSize?: string;
  /** Font size for the text */
  fontSize?: string;
  /** Whether to show the colored text */
  showColoredText?: boolean;
};

/**
 * Combined circle + text display for pass rate.
 */
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
      {Math.round(passRate)}%
    </Text>
  </HStack>
);
