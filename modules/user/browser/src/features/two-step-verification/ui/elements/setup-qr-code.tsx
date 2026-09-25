/**
 * The scannable setup code. The ink is a fixed near-black on a white tile in
 * both themes: a code that follows the theme's foreground goes light-on-white
 * in dark mode, and scanners want dark modules on a light ground anyway.
 */
import { QrCode } from "@chakra-ui/react";

export function SetupQrCode({ value }: { value: string }) {
  return (
    <QrCode.Root value={value} size="xl" encoding={{ ecc: "M" }} aria-label="Scannable setup code">
      <QrCode.Frame fill="gray.950">
        <QrCode.Pattern />
      </QrCode.Frame>
    </QrCode.Root>
  );
}
