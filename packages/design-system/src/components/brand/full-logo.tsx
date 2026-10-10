/** The product lockup: the mark beside the wordmark, in the `logo.*` colour-mode tokens. */
import { chakra } from "@chakra-ui/react";

import type { LogoColorMode } from "./logo-icon.tsx";
import { colorModeClass, LogoMark } from "./logo-icon.tsx";
import { LANG_PATH, WATCH_PATH } from "./logo-paths.ts";

export function FullLogo({
  width = 155,
  height = 38,
  forceColorMode,
}: {
  width?: number;
  height?: number;
  forceColorMode?: LogoColorMode;
}) {
  return (
    <chakra.svg
      xmlns="http://www.w3.org/2000/svg"
      width={`${width}px`}
      height={`${height}px`}
      fill="none"
      viewBox="0 0 155 38"
      flexShrink={0}
      className={colorModeClass(forceColorMode)}
    >
      <g transform="translate(3 3) scale(0.6)">
        <LogoMark />
      </g>
      <chakra.path fill="logo.wordmark" d={LANG_PATH} />
      <chakra.path fill="logo.wordmarkMuted" d={WATCH_PATH} />
    </chakra.svg>
  );
}
