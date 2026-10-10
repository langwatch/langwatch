// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The frame the setup screen's tables sit in: one component, so the domains table
 * and the break-glass table read as one screen.
 */
import { ListTable } from "@langwatch/design-system/list-table";
import type { ReactNode } from "react";

export function SettingsTable({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <ListTable
      size="sm"
      data-testid={testId}
      containerProps={{ width: "full", minWidth: 0, overflowX: "auto" }}
      css={{ "& tbody tr:last-of-type td": { borderBottomWidth: 0 } }}
    >
      {children}
    </ListTable>
  );
}
