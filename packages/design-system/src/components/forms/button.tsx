import { AbsoluteCenter, Button as ChakraButton, Spinner, Span } from "@chakra-ui/react";
import type { ButtonProps } from "@chakra-ui/react";
import * as React from "react";

const TINTED_PALETTES = new Set([
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
  "blue",
  "cyan",
  "purple",
  "pink",
]);

/** The outline recipe draws neutral; a hue passed as `colorPalette` tints its border and label. */
function outlineTint({ variant, colorPalette }: Pick<ButtonProps, "variant" | "colorPalette">) {
  if (variant !== "outline" || typeof colorPalette !== "string") return {};
  if (!TINTED_PALETTES.has(colorPalette)) return {};
  return { borderColor: "colorPalette.solid", color: "colorPalette.fg" } as const;
}

/**
 * Chakra's Button with two changes: a loading button without `loadingText` keeps its label in the
 * accessibility tree (Chakra hides it with `visibility: hidden`), and an outline button takes the
 * hue its `colorPalette` names.
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(props, ref) {
  const { loading, loadingText, spinner, children, asChild, disabled, ...base } = props;
  const rest = { ...outlineTint(base), ...base };
  if (!loading || loadingText || asChild) {
    return (
      <ChakraButton
        ref={ref}
        loading={loading}
        loadingText={loadingText}
        spinner={spinner}
        asChild={asChild}
        disabled={disabled}
        aria-busy={loading ? true : undefined}
        {...rest}
      >
        {children}
      </ChakraButton>
    );
  }
  return (
    <ChakraButton ref={ref} loading spinner={null} aria-busy {...rest}>
      <AbsoluteCenter display="inline-flex" aria-hidden>
        {spinner ?? <Spinner size="inherit" borderWidth="0.125em" color="inherit" />}
      </AbsoluteCenter>
      <Span display="inline-flex" alignItems="center" gap="inherit" opacity={0}>
        {children}
      </Span>
    </ChakraButton>
  );
});

export type { ButtonProps };
