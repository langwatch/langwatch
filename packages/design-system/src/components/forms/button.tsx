import { AbsoluteCenter, Button as ChakraButton, Spinner, Span } from "@chakra-ui/react";
import type { ButtonProps } from "@chakra-ui/react";
import * as React from "react";

/**
 * Chakra's Button with one change: a loading button without `loadingText` keeps its label in the
 * accessibility tree. Chakra hides the label with `visibility: hidden`, which removes the name.
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(props, ref) {
  const { loading, loadingText, spinner, children, asChild, disabled, ...rest } = props;
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
