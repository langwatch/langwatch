/**
 * The board header's share control, after the prototype's Share menu: Only me,
 * Team or Organisation. Disabled, with the reason, for a member who may not
 * change it; a server refusal is said beside it in the registry's words.
 */

import { Button, HStack, Text, VStack } from "@chakra-ui/react";
import { DASHBOARD_VISIBILITIES, type DashboardVisibility } from "@langwatch/dashboard-contract";
import { Menu } from "@langwatch/design-system/menu";
import { explainAnyError } from "@langwatch/error-presentation/presentation";
import { Building2, Lock, type LucideIcon, Users } from "lucide-react";

import {
  BOARD_VISIBILITY_LOCKED_REASON,
  boardVisibilityLabel,
} from "../../model/board-visibility.ts";

const VISIBILITY_ICONS: Readonly<Record<DashboardVisibility, LucideIcon>> = {
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
  const Icon = VISIBILITY_ICONS[visibility];
  const trigger = (
    <Button
      variant="outline"
      size="sm"
      aria-label={`Visibility: ${boardVisibilityLabel(visibility)}`}
      title={canChange ? void 0 : BOARD_VISIBILITY_LOCKED_REASON}
      disabled={!canChange}
    >
      <Icon size={14} /> {boardVisibilityLabel(visibility)}
    </Button>
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
                    <HStack gap={2}>
                      <OptionIcon size={14} />
                      {boardVisibilityLabel(option)}
                      {option === visibility && " ✓"}
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
