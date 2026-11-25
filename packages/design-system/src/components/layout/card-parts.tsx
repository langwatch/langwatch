import { Card as ChakraCard } from "@chakra-ui/react";
import * as React from "react";

/** Product adds custom variants to Chakra's card recipe. */
type CardPartsVariant = NonNullable<ChakraCard.RootProps["variant"]> | "showcase";

export interface CardRootProps extends Omit<ChakraCard.RootProps, "variant"> {
  variant?: CardPartsVariant;
}

export const CardRoot = React.forwardRef<HTMLDivElement, CardRootProps>(function CardRoot(
  { variant, ...props },
  ref,
) {
  return (
    <ChakraCard.Root ref={ref} variant={variant as ChakraCard.RootProps["variant"]} {...props} />
  );
});

/** The composable Chakra card parts with the product `showcase` variant typed on the root. */
export const CardParts: {
  Root: typeof CardRoot;
  Body: typeof ChakraCard.Body;
  Header: typeof ChakraCard.Header;
  Footer: typeof ChakraCard.Footer;
  Title: typeof ChakraCard.Title;
  Description: typeof ChakraCard.Description;
  PropsProvider: typeof ChakraCard.PropsProvider;
} = {
  Root: CardRoot,
  Body: ChakraCard.Body,
  Header: ChakraCard.Header,
  Footer: ChakraCard.Footer,
  Title: ChakraCard.Title,
  Description: ChakraCard.Description,
  PropsProvider: ChakraCard.PropsProvider,
};
