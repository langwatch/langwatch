/**
 * The board header's share control, after the prototype's icon-only Share
 * menu: Only me, Team or Organisation. Disabled, with the reason, for a member
 * who may not change it; a server refusal is said beside it in the registry's words.
 */

import { Box, HStack, IconButton, Text, VStack } from "@chakra-ui/react";
import { DASHBOARD_VISIBILITIES, type DashboardVisibility } from "@langwatch/dashboard-contract";
import { Menu } from "@langwatch/design-system/menu";
import { explainAnyError } from "@langwatch/error-presentation/presentation";
import { Building2, Check, Lock, type LucideIcon, Share2, Users } from "lucide-react";

import {
  BOARD_VISIBILITY_LOCKED_REASON,
  boardVisibilityLabel,
} from "../../model/board-visibility.ts";

/** The icon each audience wears, here and in the sidebar row's Share menu. */
export const VISIBILITY_ICONS: Readonly<Record<DashboardVisibility, LucideIcon>> = {
  only_me: Lock,
  team: Users,
  organisation: Building2,
};

export function BoardVisibilityControl({
  visibility,
  canChange,
  refusal,
  onChange,
}: {
  readonly visibility: DashboardVisibility;
  readonly canChange: boolean;
  readonly refusal: unknown;
  readonly onChange: (visibility: DashboardVisibility) => void;
}) {
  const label = `Visibility: ${boardVisibilityLabel(visibility)}`;
  const trigger = (
    <IconButton
      variant="ghost"
      height={8}
      minWidth={0}
      paddingX={2}
      borderRadius="lg"
      color="fg.subtle"
      _hover={{ background: "bg.muted", color: "fg" }}
      aria-label={label}
      title={canChange ? label : BOARD_VISIBILITY_LOCKED_REASON}
      disabled={!canChange}
    >
      <Share2 size={15} strokeWidth={2} />
    </IconButton>
  );

  return (
    <VStack align="end" gap={1} flexShrink={0}>
      {canChange ? (
        <Menu.Root>
          <Menu.Trigger asChild>{trigger}</Menu.Trigger>
          <Menu.Content>
            <Menu.ItemGroup title="Who can see this dashboard">
              {DASHBOARD_VISIBILITIES.map((option) => {
                const OptionIcon = VISIBILITY_ICONS[option];
                return (
                  <Menu.Item
                    key={option}
                    value={`visibility-${option}`}
                    onClick={() => onChange(option)}
                  >
                    <HStack width="full" gap={2} fontSize="12.5px">
                      <OptionIcon size={13} />
                      {boardVisibilityLabel(option)}
                      {option === visibility && (
                        <Box as="span" marginLeft="auto">
                          <Check size={13} aria-label="selected" />
                        </Box>
                      )}
                    </HStack>
                  </Menu.Item>
                );
              })}
            </Menu.ItemGroup>
          </Menu.Content>
        </Menu.Root>
      ) : (
        trigger
      )}
      {refusal !== null && <VisibilityRefusal error={refusal} />}
    </VStack>
  );
}

function VisibilityRefusal({ error }: { error: unknown }) {
  const { title, description } = explainAnyError(error);
  return (
    <VStack role="alert" align="end" gap={0} maxWidth="sm" textAlign="end">
      <Text fontSize="12px" fontWeight="medium" color="red.fg">
        {title}
      </Text>
      {description && (
        <Text fontSize="12px" color="fg.muted">
          {description}
        </Text>
      )}
    </VStack>
  );
}
