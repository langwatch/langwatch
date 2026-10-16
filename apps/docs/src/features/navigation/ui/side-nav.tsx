import { Box } from "@langwatch/design-system/primitives";

import { AgentLauncher } from "../../shell/ui/agent-launcher.tsx";
import type { Section } from "../model/nav.ts";
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
      <AgentLauncher />
      <SectionAnchors active={active} />
      <Box marginTop="5" paddingTop="5" borderTopWidth="1px" borderColor="border">
        {active ? (
          <NavTree items={active.children} current={slug} section={active.title} id={treeId} />
        ) : null}
      </Box>
    </>
  );
}
