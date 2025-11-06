export interface ThemedIcon {
  type: "themed";
  lightSrc: string;
  darkSrc: string;
  alt: string;
}

export interface SingleIcon {
  type: "single";
  src: string;
  alt: string;
}

export interface IconWithLabel {
  type: "with-label";
  icon: ThemedIcon | SingleIcon;
  label: string;
}

export type IconData = ThemedIcon | SingleIcon | IconWithLabel;

export interface Docs {
  internal?: string;
  external?: string;
}

/**
 * Creates a themed icon configuration for light and dark modes
 */
export function themedIcon(lightSrc: string, darkSrc: string, alt: string): ThemedIcon {
  return {
    type: "themed",
    lightSrc,
    darkSrc,
    alt,
  };
}

/**
 * Creates a single icon configuration that works in both light and dark modes
 */
export function singleIcon(src: string, alt: string): SingleIcon {
  return {
    type: "single",
    src,
    alt,
  };
}

/**
 * Creates an icon with a label underneath
 */
export function iconWithLabel(icon: ThemedIcon | SingleIcon, label: string): IconWithLabel {
  return {
    type: "with-label",
    icon,
    label,
  };
}
