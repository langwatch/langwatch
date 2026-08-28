/**
 * The label of one action in a menu of the Scenarios tab: an icon, then the
 * words.
 *
 * The suites rail and the scenario rows offer the same actions, so the icon of
 * an action is named once here and both menus read it. An action means the
 * same thing wherever it is offered, and it looks the same too.
 *
 * @see dev/docs/best_practices/row-actions-overflow-menu.md
 */

import { HStack, Icon } from "@chakra-ui/react";
import {
  Archive,
  Copy,
  FolderInput,
  ListChecks,
  Pencil,
  Play,
  Plus,
} from "lucide-react";

/** The icon of every action the two menus offer, keyed by what it does. */
export const MENU_ACTION_ICONS = {
  newScenario: Plus,
  runSuite: Play,
  rename: Pencil,
  edit: Pencil,
  openLastRun: ListChecks,
  duplicate: Copy,
  moveToSuite: FolderInput,
  archive: Archive,
} as const;

export type MenuActionName = keyof typeof MENU_ACTION_ICONS;

export function MenuActionLabel({
  action,
  children,
}: {
  action: MenuActionName;
  children: React.ReactNode;
}) {
  return (
    <HStack gap={2}>
      <Icon as={MENU_ACTION_ICONS[action]} boxSize={3.5} />
      {children}
    </HStack>
  );
}
