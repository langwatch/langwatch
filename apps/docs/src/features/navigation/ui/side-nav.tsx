import { Box } from "@langwatch/design-system/primitives";
import type { ReactNode } from "react";

import type { Section } from "../model/nav.ts";
import { NavTree } from "./nav-tree.tsx";
import { SectionAnchors } from "./section-anchors.tsx";
import { pages } from "./site-nav.ts";

/** `launcher` is the agent launcher the shell composes above the rail. */
export function SideNav({
  active,
  launcher,
  slug,
  treeId,
}: {
  active: Section | undefined;
  launcher: ReactNode;
  slug: string;
  treeId?: string;
}) {
  return (
    <>
      {launcher}
      <SectionAnchors active={active} />
      <Box marginTop="5" paddingTop="5" borderTopWidth="1px" borderColor="border">
        {active ? (
          <NavTree
            items={active.children}
            pages={pages}
            current={slug}
            section={active.title}
            id={treeId}
          />
        ) : null}
      </Box>
    </>
  );
}
