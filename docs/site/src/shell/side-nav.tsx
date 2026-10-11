import { Box } from "@langwatch/design-system/primitives";

import type { Section } from "../lib/nav-model.ts";
import { NavTree } from "./nav-tree.tsx";
import { SectionAnchors } from "./section-anchors.tsx";

export function SideNav({
  active,
  slug,
  treeId,
}: {
  active: Section | undefined;
  slug: string;
  treeId?: string;
}) {
  return (
    <>
      <SectionAnchors active={active} />
      <Box marginTop="5" paddingTop="5" borderTopWidth="1px" borderColor="border">
        {active ? <NavTree items={active.children} current={slug} id={treeId} /> : null}
      </Box>
    </>
  );
}
