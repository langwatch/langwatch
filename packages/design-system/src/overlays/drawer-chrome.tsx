import { chakra, Drawer as ChakraDrawer } from "@chakra-ui/react";
import type { ReactNode, Ref } from "react";

import { drawerGlassFooter, drawerGlassHeader, raisedFooter } from "../system/drawer.recipe.ts";

/**
 * The header and the toolbar as one band. In a glass drawer it overlays the top of the body;
 * otherwise it draws nothing, so the header and toolbar stay the body's flex siblings.
 */
export function DrawerHeaderBand({
  glass,
  edge,
  bandRef,
  children,
}: {
  glass: boolean;
  edge: boolean;
  bandRef: Ref<HTMLDivElement>;
  children: ReactNode;
}) {
  if (!glass) return <chakra.div display="contents">{children}</chakra.div>;
  return (
    <chakra.div
      ref={bandRef}
      data-chrome="header"
      data-edge={edge ? "on" : "off"}
      css={drawerGlassHeader}
    >
      {children}
    </chakra.div>
  );
}

/** The footer: a flex sibling of the body, or in a glass drawer an overlay along its bottom. */
export function DrawerFooterBand({
  glass,
  edge,
  bandRef,
  paddingBottom,
  raised = false,
  children,
}: {
  raised?: boolean;
  glass: boolean;
  edge: boolean;
  bandRef: Ref<HTMLDivElement>;
  paddingBottom: string;
  children: ReactNode;
}) {
  if (raised) {
    return (
      <ChakraDrawer.Footer
        paddingBottom={paddingBottom}
        paddingX={6}
        borderTopWidth={0}
        background="bg.panel"
        position="relative"
        zIndex={1}
        data-chrome="footer"
        data-appearance="raised"
        data-edge={edge ? "on" : "off"}
        css={raisedFooter}
      >
        {children}
      </ChakraDrawer.Footer>
    );
  }
  if (!glass) {
    return <ChakraDrawer.Footer paddingBottom={paddingBottom}>{children}</ChakraDrawer.Footer>;
  }
  return (
    <ChakraDrawer.Footer
      ref={bandRef}
      paddingBottom={paddingBottom}
      data-chrome="footer"
      data-edge={edge ? "on" : "off"}
      css={drawerGlassFooter}
    >
      {children}
    </ChakraDrawer.Footer>
  );
}
