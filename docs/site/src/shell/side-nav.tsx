import { Box } from "@langwatch/design-system/primitives";
import type { Section } from "../lib/nav-model.ts";
import { NavTree } from "./nav-tree.tsx";
import { SectionAnchors } from "./section-anchors.tsx";

type SideNavProps = { active: Section | undefined; slug: string; treeId?: string; scrollTree?: boolean };

/** Section anchors, then the active section's tree; with scrollTree the anchors stay put while the tree scrolls. */
export function SideNav({ active, slug, treeId, scrollTree = false }: SideNavProps) {
  const tree = active ? <NavTree items={active.children} current={slug} id={treeId} /> : null;
  if (!scrollTree) {
    return (
      <>
        <SectionAnchors active={active} />
        <Box marginTop="6">{tree}</Box>
      </>
    );
  }
  return (
    <>
      <Box flexShrink={0}>
        <SectionAnchors active={active} />
      </Box>
      <Box
        marginTop="6"
        flex="1 1 auto"
        minHeight="12rem"
        overflowY="auto"
        data-docs-scroll=""
        paddingBottom="10"
        css={{ scrollbarWidth: "thin" }}
      >
        {tree}
      </Box>
    </>
  );
}
