/** The LangWatch mark, drawn in the `logo.*` colour-mode tokens. */
import { chakra } from "@chakra-ui/react";

import { LOGO_LINES_PATH, LOGO_PLATE_PATH } from "./logo-paths.ts";

export type LogoColorMode = "light" | "dark";

/** Pins the tokens to one mode, as `LightMode` and `DarkMode` do. */
export function colorModeClass(forceColorMode?: LogoColorMode): string | undefined {
  return forceColorMode ? `chakra-theme ${forceColorMode}` : undefined;
}

/** The mark's two paths at mark scale (38 by 52); the caller owns the svg. */
export function LogoMark() {
  return (
    <>
      <chakra.path d={LOGO_PLATE_PATH} fill="logo.face" />
      <chakra.path d={LOGO_LINES_PATH} fill="logo.mark" />
    </>
  );
}

/** The mark alone, unstroked so its cut-outs and shaded face match main's. */
export function LogoIcon({
  height = 24,
  width = (height * 38) / 52,
  forceColorMode,
}: {
  height?: number;
  width?: number;
  forceColorMode?: LogoColorMode;
}) {
  return (
    <chakra.svg
      xmlns="http://www.w3.org/2000/svg"
      width={`${width}px`}
      height={`${height}px`}
      fill="none"
      viewBox="0 0 38 52"
      flexShrink={0}
      aria-hidden="true"
      className={colorModeClass(forceColorMode)}
    >
      <LogoMark />
    </chakra.svg>
  );
}
