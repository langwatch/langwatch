import { Box } from "@langwatch/design-system/primitives";
import type { Section } from "../lib/nav-model.ts";
import { NavTree } from "./nav-tree.tsx";
import { SectionAnchors } from "./section-anchors.tsx";

/** The two-level navigation: section anchors, then only the active section's groups and pages. */
export function SideNav({ active, slug, treeId }: { active: Section | undefined; slug: string; treeId?: string }) {
  return (
    <>
      <SectionAnchors active={active} />
      <Box marginTop="6">{active ? <NavTree items={active.children} current={slug} id={treeId} /> : null}</Box>
    </>
  );
}
