/**
 * Foundry entry point for the Langy panel header (task #28).
 *
 * The Foundry is LangWatch's browser trace/conversation generator — an
 * internal tool for forging sample traces and multi-turn conversations to
 * exercise the platform. Wiring it into Langy lets you hand off from a
 * conversation ("generate some demo traces") straight into the generator.
 *
 * Admin/dev only: gated on `useOpsPermission().hasAccess` — the exact same gate
 * that guards the Foundry page (`OpsPageShell`), its sidebar entry, and its
 * command-bar action. Non-ops users never see this control, and the drawer it
 * opens carries the same ops assumption, so there is no new privilege surface.
 *
 * Hidden entirely while the ops probe is still loading, mirroring how the other
 * header controls stay out of the way until they know whether to show.
 */
import { Box, IconButton, Text } from "@chakra-ui/react";
import { Hammer } from "lucide-react";

import { Menu } from "~/components/ui/menu";
import { TriggerAnchor } from "~/components/ui/TriggerAnchor";
import { Tooltip } from "~/components/ui/tooltip";
import { useDrawer } from "~/hooks/useDrawer";
import { useOpsPermission } from "~/hooks/useOpsPermission";

export function LangyFoundryMenu() {
  const { hasAccess, isLoading } = useOpsPermission();
  const { openDrawer } = useDrawer();

  // Non-ops users never see the Foundry; keep it hidden until the probe settles
  // so it can't flash in and out on first paint.
  if (isLoading || !hasAccess) return null;

  return (
    <Menu.Root positioning={{ placement: "bottom-end" }}>
      <Tooltip content="The Foundry — forge sample traces & conversations" showArrow>
        <TriggerAnchor>
          <Menu.Trigger asChild>
            <IconButton
              size="xs"
              variant="ghost"
              aria-label="Open the Foundry"
              color="fg.muted"
            >
              <Hammer size={14} />
            </IconButton>
          </Menu.Trigger>
        </TriggerAnchor>
      </Tooltip>
      <Menu.Content
        minWidth="240px"
        // Liquid-glass — matches RecentChatsMenu / LangyGitHubMenu so the header
        // dropdowns read as one material.
        background="bg.panel/70"
        borderWidth="1px"
        borderColor="border.muted"
        boxShadow="lg"
        css={{
          backdropFilter: "blur(18px) saturate(0.5)",
          WebkitBackdropFilter: "blur(18px) saturate(0.5)",
        }}
      >
        <Menu.ItemGroup>
          <Box paddingX={2} paddingY={1}>
            <Text fontSize="xs" fontWeight="600" color="fg">
              The Foundry
            </Text>
            <Text fontSize="2xs" color="fg.muted">
              Generate sample traces and conversations to exercise the platform.
            </Text>
          </Box>
        </Menu.ItemGroup>
        <Menu.Separator />
        <Menu.Item
          value="open-foundry"
          onClick={() => openDrawer("foundry", undefined)}
        >
          Open the Foundry
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}
