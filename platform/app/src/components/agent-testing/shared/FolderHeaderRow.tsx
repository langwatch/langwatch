/**
 * The row that opens a folder of scenarios inside a table: the folder and
 * how many cases it holds.
 *
 * The row carries no result summary: the cases table is authoring only, so
 * results stay on the Results tab.
 *
 * The target is a real button that spans the row, so it takes focus and
 * answers Enter and Space.
 */
import { chakra, HStack, Icon, Text } from "@chakra-ui/react";
import { ChevronRight, Folder, type LucideIcon } from "lucide-react";
import { FG_MUTED, GROUP_HEADER_BG, QUIET_BUTTON_SHADOW } from "./design";

export type FolderHeaderRowProps = {
  name: string;
  /** How many scenarios the folder holds. */
  caseCount: number;
  /** The columns of the table, so the row lines up with the rows under it. */
  templateColumns: string;
  icon?: LucideIcon;
  /** True for a group that follows another one, which takes a rule above it. */
  separated?: boolean;
  onClick?: () => void;
};

export function FolderHeaderRow({
  name,
  caseCount,
  templateColumns,
  icon: FolderIcon = Folder,
  separated,
  onClick,
}: FolderHeaderRowProps) {
  return (
    <chakra.button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      display="grid"
      gridTemplateColumns={templateColumns}
      columnGap={3}
      alignItems="center"
      width="full"
      textAlign="left"
      paddingX={4}
      paddingY="10px"
      background={GROUP_HEADER_BG}
      boxShadow={QUIET_BUTTON_SHADOW}
      borderBottomWidth="1px"
      borderBottomColor="border.muted"
      borderTopWidth={separated ? "1px" : undefined}
      borderTopColor={separated ? "border" : undefined}
      cursor={onClick ? "pointer" : "default"}
      _hover={onClick ? { background: "bg.muted/60" } : undefined}
      data-testid={`folder-header-row-${name}`}
    >
      <HStack gap={1.5} minWidth={0}>
        <Icon as={FolderIcon} boxSize="12px" color={FG_MUTED} flexShrink={0} />
        <Text fontSize="12px" fontWeight="semibold" color="fg" truncate>
          {name}
        </Text>
        <Text
          fontSize="10.5px"
          color={FG_MUTED}
          aria-label={caseCount === 1 ? "1 scenario" : `${caseCount} scenarios`}
        >
          {caseCount}
        </Text>
      </HStack>
      {/* The chevron says the row opens the folder, so a row that opens
          nothing does not carry one. */}
      {onClick && (
        <Icon
          as={ChevronRight}
          boxSize="13px"
          color={FG_MUTED}
          marginLeft="auto"
          flexShrink={0}
        />
      )}
    </chakra.button>
  );
}
