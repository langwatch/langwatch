import { Box } from "@langwatch/design-system/primitives";
import { Children, isValidElement } from "react";
import type { ReactNode } from "react";

import { InFrame, shotKind } from "./media.tsx";

/** A frame of SVG diagrams only drops the window bar; any screenshot or video keeps it. */
function frameKind({ node }: { node: ReactNode }): "diagram" | "shot" {
  const sources: string[] = [];
  const visit = (child: ReactNode) => {
    Children.forEach(child, (item) => {
      if (!isValidElement<{ src?: string; children?: ReactNode }>(item)) return;
      if (item.props.src !== undefined) sources.push(item.props.src);
      visit(item.props.children);
    });
  };
  visit(node);
  const diagrams = sources.length > 0 && sources.every((src) => shotKind({ src }) === "diagram");
  return diagrams ? "diagram" : "shot";
}

/** Authored media sits in the shared window frame (docs.css `.docs-shot`); the caption below. */
export function Frame({
  caption,
  children,
}: {
  caption?: string;
  fullWidth?: boolean;
  children?: ReactNode;
}) {
  return (
    <Box as="figure" margin="0" marginY="6" minWidth="0">
      <div className="docs-shot" data-shot={frameKind({ node: children })}>
        <InFrame.Provider value={true}>{children}</InFrame.Provider>
      </div>
      {caption ? (
        <Box
          as="figcaption"
          marginTop="3"
          fontSize="12px"
          lineHeight="20px"
          color="fg.muted"
          textAlign="center"
        >
          {caption}
        </Box>
      ) : null}
    </Box>
  );
}
