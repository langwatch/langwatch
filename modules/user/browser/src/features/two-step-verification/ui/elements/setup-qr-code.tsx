/**
 * The scannable setup code. The ink is a fixed near-black on a white tile in
 * both themes: a code that follows the theme's foreground goes light-on-white
 * in dark mode, and scanners want dark modules on a light ground anyway.
 */
import { LightMode } from "@langwatch/design-system/color-mode";
import { QrCode } from "@langwatch/design-system/primitives";

export function SetupQrCode({ value }: { value: string }) {
  return (
    <LightMode>
      <QrCode.Root
        bg="bg.card"
        padding={3}
        value={value}
        size="xl"
        encoding={{ ecc: "M" }}
        aria-label="Scannable setup code"
      >
        <QrCode.Frame fill="fg">
          <QrCode.Pattern />
        </QrCode.Frame>
      </QrCode.Root>
    </LightMode>
  );
}
