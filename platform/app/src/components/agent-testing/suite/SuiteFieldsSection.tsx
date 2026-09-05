/**
 * The fields section of the suite editor: one row per field, each an
 * identifier and a type, dragged into order by its handle and removed by its
 * X.
 *
 * @see specs/features/agent-testing/suite-editor.feature
 */

import {
  Box,
  chakra,
  HStack,
  IconButton,
  Input,
  NativeSelect,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, X } from "lucide-react";
import {
  SUITE_FIELD_TYPES,
  type SuiteFieldType,
} from "~/server/scenarios/suite-fields";
import {
  DIALOG_FIELD_STYLE,
  FieldError,
  FieldLabel,
} from "../shared/DialogFields";
import { FG_MUTED, QUIET_BUTTON_SHADOW } from "../shared/design";
import { RemoveBlockButton } from "../shared/RemoveBlockButton";
import type { SuiteFieldRow } from "./suiteEditorStore";

/** What each type is called where a person picks one. */
export const SUITE_FIELD_TYPE_LABELS: Record<SuiteFieldType, string> = {
  text: "Text",
  number: "Number",
  boolean: "Boolean",
};

export const FIELDS_SECTION_HELP =
  "The columns every scenario in this suite carries, beyond its situation and criteria. Evaluators read them.";

/** The placeholder of an unnamed field, an example of what a field is. */
export const FIELD_IDENTIFIER_PLACEHOLDER = "expected_tools";

export type SuiteFieldsSectionProps = {
  rows: SuiteFieldRow[];
  /** A refusal about the fields as a whole. */
  error?: string;
  onPatch: (
    index: number,
    patch: Partial<Pick<SuiteFieldRow, "identifier" | "type">>,
  ) => void;
  onReorder: (input: { from: number; to: number }) => void;
  onRemove: (index: number) => void;
  onAdd: () => void;
  onClose: () => void;
};

/** A quiet control of a row: drag it, or take it away. */
function RowButton({
  label,
  onClick,
  children,
  danger,
  grab,
  ...rest
}: {
  label: string;
  onClick?: () => void;
  children: React.ReactNode;
  danger?: boolean;
  /** True for the drag handle, which reads as something to pick up. */
  grab?: boolean;
} & Omit<React.ComponentProps<typeof IconButton>, "aria-label" | "onClick">) {
  return (
    <IconButton
      aria-label={label}
      title={label}
      size="2xs"
      variant="ghost"
      height="22px"
      minWidth="22px"
      color={FG_MUTED}
      boxShadow={QUIET_BUTTON_SHADOW}
      cursor={grab ? "grab" : undefined}
      _hover={{ color: danger ? "red.fg" : "fg" }}
      onClick={onClick}
      {...rest}
    >
      {children}
    </IconButton>
  );
}

function FieldRow({
  row,
  index,
  isSortable,
  autoFocus,
  onPatch,
  onRemove,
}: {
  row: SuiteFieldRow;
  index: number;
  /** False while the suite has a single field: there is nothing to reorder. */
  isSortable: boolean;
  autoFocus: boolean;
} & Pick<SuiteFieldsSectionProps, "onPatch" | "onRemove">) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: row.key, disabled: !isSortable });

  return (
    <Box
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
      }}
      zIndex={isDragging ? 1 : undefined}
      data-testid={`suite-field-row-${index}`}
    >
      <HStack
        gap={1.5}
        borderWidth="1px"
        borderColor={row.error ? "red.solid" : "border"}
        borderRadius="lg"
        paddingX={2}
        paddingY={1.5}
      >
        {isSortable && (
          <RowButton label="Reorder field" grab {...attributes} {...listeners}>
            <GripVertical size={12} />
          </RowButton>
        )}
        <Input
          {...DIALOG_FIELD_STYLE}
          flex={1}
          minWidth={0}
          fontFamily="mono"
          fontSize="12px"
          paddingY={1}
          aria-label={`Field ${index + 1} identifier`}
          placeholder={FIELD_IDENTIFIER_PLACEHOLDER}
          autoFocus={autoFocus}
          value={row.identifier}
          onChange={(event) =>
            onPatch(index, { identifier: event.target.value })
          }
        />
        <NativeSelect.Root size="sm" width="110px" flexShrink={0}>
          <NativeSelect.Field
            {...DIALOG_FIELD_STYLE}
            paddingY={1}
            fontSize="12px"
            aria-label={`Field ${index + 1} type`}
            value={row.type}
            onChange={(event) =>
              onPatch(index, { type: event.target.value as SuiteFieldType })
            }
          >
            {SUITE_FIELD_TYPES.map((type) => (
              <option key={type} value={type}>
                {SUITE_FIELD_TYPE_LABELS[type]}
              </option>
            ))}
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
        <RowButton label="Remove field" danger onClick={() => onRemove(index)}>
          <X size={12} />
        </RowButton>
      </HStack>
      <FieldError message={row.error} />
    </Box>
  );
}

export function SuiteFieldsSection({
  rows,
  error,
  onPatch,
  onReorder,
  onRemove,
  onAdd,
  onClose,
}: SuiteFieldsSectionProps) {
  // The newest empty row takes the focus, so a field added is a field being
  // named. A row that already holds a name is left alone.
  const lastEmpty = rows.findLastIndex((row) => row.identifier === "");

  // A short pointer distance keeps an ordinary click on the handle from
  // starting a drag. The keyboard sensor is what makes the order reachable
  // without a pointer, since the arrow buttons are gone.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = rows.findIndex((row) => row.key === active.id);
    const to = rows.findIndex((row) => row.key === over.id);
    if (from === -1 || to === -1) return;
    onReorder({ from, to });
  };

  return (
    <VStack align="stretch" gap={1.5} data-testid="suite-fields-section">
      <FieldLabel>
        Fields
        <RemoveBlockButton label="Remove the fields" onClick={onClose} />
      </FieldLabel>
      <Text fontSize="11px" color={FG_MUTED}>
        {FIELDS_SECTION_HELP}
      </Text>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={rows.map((row) => row.key)}
          strategy={verticalListSortingStrategy}
        >
          <VStack align="stretch" gap={1.5}>
            {rows.map((row, index) => (
              <FieldRow
                key={row.key}
                row={row}
                index={index}
                isSortable={rows.length > 1}
                autoFocus={index === lastEmpty}
                onPatch={onPatch}
                onRemove={onRemove}
              />
            ))}
          </VStack>
        </SortableContext>
      </DndContext>
      <FieldError message={error} />
      <chakra.button
        type="button"
        alignSelf="flex-start"
        fontSize="12px"
        fontWeight="medium"
        color="blue.fg"
        cursor="pointer"
        _hover={{ textDecoration: "underline" }}
        onClick={onAdd}
        data-testid="suite-add-field"
      >
        + Add field
      </chakra.button>
    </VStack>
  );
}
