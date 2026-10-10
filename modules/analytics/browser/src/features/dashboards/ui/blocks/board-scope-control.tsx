/**
 * A board's scope beside its title, shaped as the prompt scope picker: an outline button with
 * an icon and the current value, opening the three choices with a tick on the current one. A
 * reader who may not change it sees the same value as a badge that says why on hover.
 * @see modules/dashboard/specs/dashboards-v2.feature AC177, AC178
 */

import type { DashboardScope, DashboardScopeLock } from "@langwatch/dashboard-contract";
import { Menu } from "@langwatch/design-system/menu";
import { Box, Button, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { ChevronDown } from "lucide-react";

import {
  DASHBOARD_SCOPES,
  guestBadgeLabel,
  SCOPE_LABEL,
  SCOPE_MENU,
  scopeHint,
  scopeLockedTip,
  type ScopeNames,
} from "../../model/board-scope.ts";
import { SCOPE_ICON } from "../elements/scope-mark.tsx";

/** The three choices, one of them ticked; the header's menu and the sidebar's share them. */
export function ScopeChoices({
  scope,
  names,
  onPick,
}: {
  scope: DashboardScope;
  names: ScopeNames;
  onPick: (scope: DashboardScope) => void;
}) {
  return (
    <Menu.RadioItemGroup
      aria-label={SCOPE_MENU.title}
      value={scope}
      onValueChange={({ value }) => {
        const picked = DASHBOARD_SCOPES.find((choice) => choice === value);
        if (picked !== void 0 && picked !== scope) onPick(picked);
      }}
    >
      <Box paddingX={2} paddingTop={1} paddingBottom={1.5}>
        <Text
          fontSize="9.5px"
          fontWeight="semibold"
          letterSpacing="0.09em"
          textTransform="uppercase"
          color="fg.subtle"
        >
          {SCOPE_MENU.title}
        </Text>
        <Text fontSize="11.5px" color="fg.muted">
          {SCOPE_MENU.hint}
        </Text>
      </Box>
      {DASHBOARD_SCOPES.map((choice) => {
        const Icon = SCOPE_ICON[choice];
        return (
          <Menu.RadioItem key={choice} value={choice} aria-label={SCOPE_LABEL[choice]}>
            <HStack gap={2} align="start">
              <Box as="span" display="flex" flexShrink={0} marginTop="2px" color="fg.muted">
                <Icon size={14} aria-hidden />
              </Box>
              <VStack align="start" gap={0}>
                <Text fontSize="12.5px" fontWeight="medium">
                  {SCOPE_LABEL[choice]}
                </Text>
                <Text fontSize="11.5px" color="fg.muted">
                  {scopeHint({ scope: choice, names })}
                </Text>
              </VStack>
            </HStack>
          </Menu.RadioItem>
        );
      })}
    </Menu.RadioItemGroup>
  );
}

export function BoardScopeControl({
  scope,
  lock,
  names,
  onPick,
}: {
  scope: DashboardScope;
  /** Why this reader cannot change the scope; "none" when they can. */
  lock: DashboardScopeLock;
  names: ScopeNames;
  onPick: (scope: DashboardScope) => void;
}) {
  const Icon = SCOPE_ICON[scope];

  if (lock !== "none") {
    return (
      <HStack
        as="span"
        flexShrink={0}
        gap={1.5}
        borderRadius="lg"
        paddingX={2}
        paddingY={1}
        background="bg.muted"
        color="fg.muted"
        fontSize="12px"
        fontWeight="medium"
        cursor="help"
        title={scopeLockedTip({ scope, lock, names })}
        data-scope={scope}
        data-scope-locked={lock}
      >
        <Icon size={12} aria-hidden />
        {lock === "guest" ? guestBadgeLabel(names) : SCOPE_LABEL[scope]}
      </HStack>
    );
  }

  return (
    <Menu.Root positioning={{ placement: "bottom-start" }}>
      <Menu.Trigger asChild>
        <Button
          variant="outline"
          size="sm"
          height={7}
          paddingX={2}
          gap={1.5}
          flexShrink={0}
          fontSize="12px"
          aria-label={`Scope: ${SCOPE_LABEL[scope]}`}
          data-scope={scope}
        >
          <Icon size={12} aria-hidden />
          <Text>{SCOPE_LABEL[scope]}</Text>
          <ChevronDown size={12} aria-hidden />
        </Button>
      </Menu.Trigger>
      <Menu.Content minWidth="290px">
        <ScopeChoices scope={scope} names={names} onPick={onPick} />
      </Menu.Content>
    </Menu.Root>
  );
}
