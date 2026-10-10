// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The frame the setup screen's tables sit in — one component rather than two
 * copies, because the domains table and the break-glass table two steps below
 * it are meant to read as one screen, and two things that must match stop
 * matching the moment each draws its own frame.
 */
import { ListTable } from "@langwatch/design-system/list-table";
import type { ReactNode } from "react";

export function SettingsTable({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <ListTable size="sm" data-testid={testId} containerProps={{ width: "full", minWidth: 0 }}>
      {children}
    </ListTable>
  );
}
