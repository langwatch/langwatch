/**
 * The row that opens a folder of test cases inside a table: the folder, how
 * many cases it holds, and how its last run went.
 *
 * The whole row is the target, so the aggregate on the right stays a summary
 * and not a second button. The target is a real button that spans the row, so
 * it takes focus and answers Enter and Space.
 */
import { chakra, HStack, Spacer, Table, Text } from "@chakra-ui/react";
import { ChevronRight, Folder, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export type FolderHeaderRowProps = {
  name: string;
  /** How many test cases the folder holds. */
  caseCount: number;
  /** How many columns the table has, so the row spans all of them. */
  colSpan: number;
  /** The aggregate of the folder's last run, usually a RunMetricsSummary. */
  children?: ReactNode;
  icon?: LucideIcon;
  onClick?: () => void;
};

export function FolderHeaderRow({
  name,
  caseCount,
  colSpan,
  children,
  icon: Icon = Folder,
  onClick,
}: FolderHeaderRowProps) {
  const line = (
    <HStack gap={2} width="full">
      <Icon size={14} color="var(--chakra-colors-fg-muted)" />
      <Text fontSize="sm" fontWeight="semibold">
        {name}
      </Text>
      <Text fontSize="xs" color="fg.muted">
        {caseCount === 1 ? "1 test case" : `${caseCount} test cases`}
      </Text>
      <Spacer />
      {children}
      <ChevronRight size={14} color="var(--chakra-colors-fg-muted)" />
    </HStack>
  );

  return (
    <Table.Row
      cursor={onClick ? "pointer" : undefined}
      _hover={onClick ? { background: "bg.muted" } : undefined}
      data-testid={`folder-header-row-${name}`}
    >
      <Table.Cell colSpan={colSpan} paddingY={2}>
        {onClick ? (
          <chakra.button
            type="button"
            onClick={onClick}
            width="full"
            textAlign="left"
            cursor="pointer"
          >
            {line}
          </chakra.button>
        ) : (
          line
        )}
      </Table.Cell>
    </Table.Row>
  );
}
