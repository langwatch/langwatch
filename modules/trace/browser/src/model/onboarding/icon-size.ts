export const iconSizeToPixels = {
  xs: "12px",
  sm: "16px",
  md: "24px",
  lg: "32px",
  xl: "40px",
  "2xl": "48px",
} as const;

export type IconSizeKey = keyof typeof iconSizeToPixels;
