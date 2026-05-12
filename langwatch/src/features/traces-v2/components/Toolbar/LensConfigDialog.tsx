import {
  Badge,
  Box,
  Button,
  Flex,
  HStack,
  Input,
  SimpleGrid,
  Stack,
  Text,
  chakra,
  type StackProps,
} from "@chakra-ui/react";
import type React from "react";
import { useMemo } from "react";
import { LuInfo } from "react-icons/lu";
import { Checkbox } from "../../../../components/ui/checkbox";
import {
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogRoot,
  DialogTitle,
} from "../../../../components/ui/dialog";
import {
  GROUPING_LABELS,
  getCapability,
  type LensColumnOption,
} from "../../lens/capabilities";
import { isLensDraftValid } from "../../lens/schema";
import { useLensDraftStore } from "../../stores/lensDraftStore";
import { type GroupingMode } from "../../stores/viewStore";

interface LensConfigDialogProps {
  /** Called with the validated draft after the user clicks "Create lens". */
  onCreate: (input: ReturnType<typeof buildCreateInput>) => void;
}

/** Convert the validated draft into the shape `viewStore.createLens` expects. */
export function buildCreateInput(
  draft: ReturnType<typeof useLensDraftStore.getState>["draft"],
): {
  name: string;
  columns: string[];
  addons: string[];
  grouping: GroupingMode;
  sort: { columnId: string; direction: "asc" | "desc" };
  filterText: string;
} {
  return {
    name: draft.name,
    columns: draft.columns,
    addons: draft.addons,
    grouping: draft.grouping,
    sort: draft.sort,
    filterText: draft.filterText,
  };
}

/**
 * Rich "New lens" dialog. Reads/writes through `useLensDraftStore`; opening
 * is the parent's responsibility via `lensDraftStore.openDialog(seed)`.
 */
export const LensConfigDialog: React.FC<LensConfigDialogProps> = ({
  onCreate,
}) => {
  const open = useLensDraftStore((s) => s.open);
  const closeDialog = useLensDraftStore((s) => s.closeDialog);
  const validate = useLensDraftStore((s) => s.validate);

  const handleSubmit = (): void => {
    const result = validate();
    if (!result.ok) return;
    onCreate(buildCreateInput(result.draft));
    closeDialog();
  };

  return (
    <DialogRoot
      open={open}
      onOpenChange={(e) => {
        if (!e.open) closeDialog();
      }}
      size="lg"
    >
      <DialogContent errorScope="LensConfigDialog">
        <DialogHeader>
          <HStack gap={2}>
            <DialogTitle>New lens</DialogTitle>
            <Badge size="sm" colorPalette="blue" variant="subtle">
              Beta
            </Badge>
          </HStack>
        </DialogHeader>
        <DialogBody>
          <Stack gap={5}>
            <BetaBanner />
            <NameField />
            <GroupingField />
            <SortField />
            <ColumnsField />
            <AddonsField />
            <FilterField />
          </Stack>
        </DialogBody>
        <DialogFooter>
          <SubmitFooter onCancel={closeDialog} onSubmit={handleSubmit} />
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  );
};

// ---------------------------------------------------------------------------
// Field components — each binds to a slice of the draft store.
// ---------------------------------------------------------------------------

const NameField: React.FC = () => {
  const name = useLensDraftStore((s) => s.draft.name);
  const touched = useLensDraftStore((s) => s.touched);
  const setName = useLensDraftStore((s) => s.setName);
  const error = touched && !name.trim() ? "Name is required" : null;

  return (
    <FieldShell label="Name" error={error}>
      <Input
        autoFocus
        size="sm"
        placeholder="e.g. Production errors (last 24h)"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
    </FieldShell>
  );
};

const GroupingField: React.FC = () => {
  const grouping = useLensDraftStore((s) => s.draft.grouping);
  const setGrouping = useLensDraftStore((s) => s.setGrouping);

  return (
    <FieldShell
      label="Grouping"
      hint="Switching grouping resets columns and sort to that mode's defaults."
    >
      <HStack gap={1} wrap="wrap">
        {(Object.keys(GROUPING_LABELS) as GroupingMode[]).map((g) => (
          <Button
            key={g}
            size="xs"
            variant={grouping === g ? "solid" : "outline"}
            colorPalette={grouping === g ? "blue" : "gray"}
            onClick={() => setGrouping(g)}
          >
            {GROUPING_LABELS[g]}
          </Button>
        ))}
      </HStack>
    </FieldShell>
  );
};

const SortField: React.FC = () => {
  const grouping = useLensDraftStore((s) => s.draft.grouping);
  const sort = useLensDraftStore((s) => s.draft.sort);
  const setSortColumn = useLensDraftStore((s) => s.setSortColumn);
  const setSortDirection = useLensDraftStore((s) => s.setSortDirection);

  const sortableOptions = useMemo(() => {
    const capability = getCapability(grouping);
    const sortable = new Set(capability.sortableColumnIds);
    return capability.columns
      .filter((c) => sortable.has(c.id))
      .map((c) => ({ value: c.id, label: c.label }));
  }, [grouping]);

  return (
    <FieldShell label="Sort">
      <HStack gap={2}>
        <NativeSelect
          value={sort.columnId}
          onChange={setSortColumn}
          options={sortableOptions}
          width="180px"
        />
        <NativeSelect
          value={sort.direction}
          onChange={(v) => setSortDirection(v as "asc" | "desc")}
          options={[
            { value: "desc", label: "Descending" },
            { value: "asc", label: "Ascending" },
          ]}
          width="140px"
        />
      </HStack>
    </FieldShell>
  );
};

const ColumnsField: React.FC = () => {
  const grouping = useLensDraftStore((s) => s.draft.grouping);
  const selected = useLensDraftStore((s) => s.draft.columns);
  const toggleColumn = useLensDraftStore((s) => s.toggleColumn);

  const sections = useMemo(() => groupColumnsBySection(grouping), [grouping]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  return (
    <FieldShell
      label="Columns"
      hint={`${selected.length} selected`}
    >
      <Stack gap={3}>
        {sections.map(([sectionLabel, columns]) => (
          <Stack key={sectionLabel} gap={1.5}>
            {sectionLabel && (
              <Text
                fontSize="2xs"
                color="fg.subtle"
                textTransform="uppercase"
                letterSpacing="0.06em"
              >
                {sectionLabel}
              </Text>
            )}
            <SimpleGrid columns={[1, 2, 3]} gap={1}>
              {columns.map((c) => (
                <Checkbox
                  key={c.id}
                  size="sm"
                  checked={selectedSet.has(c.id)}
                  disabled={c.pinned}
                  onCheckedChange={() => toggleColumn(c.id)}
                >
                  <HStack gap={1}>
                    <Text fontSize="xs">{c.label}</Text>
                    {c.pinned && (
                      <Text fontSize="2xs" color="fg.subtle">
                        (pinned)
                      </Text>
                    )}
                  </HStack>
                </Checkbox>
              ))}
            </SimpleGrid>
          </Stack>
        ))}
      </Stack>
    </FieldShell>
  );
};

const AddonsField: React.FC = () => {
  const grouping = useLensDraftStore((s) => s.draft.grouping);
  const selected = useLensDraftStore((s) => s.draft.addons);
  const toggleAddon = useLensDraftStore((s) => s.toggleAddon);

  const capability = useMemo(() => getCapability(grouping), [grouping]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  if (capability.addons.length === 0) return null;

  return (
    <FieldShell
      label="Row addons"
      hint="Optional decorators rendered below each row."
    >
      <Stack gap={1}>
        {capability.addons.map((a) => (
          <Checkbox
            key={a.id}
            size="sm"
            checked={selectedSet.has(a.id)}
            onCheckedChange={() => toggleAddon(a.id)}
          >
            <Text fontSize="xs">{a.label}</Text>
          </Checkbox>
        ))}
      </Stack>
    </FieldShell>
  );
};

const FilterField: React.FC = () => {
  const liveFilterText = useLensDraftStore((s) => s.liveFilterText);
  const includeFilter = useLensDraftStore((s) => s.includeFilter);
  const setIncludeFilter = useLensDraftStore((s) => s.setIncludeFilter);

  const hasFilter = liveFilterText.trim().length > 0;

  return (
    <FieldShell
      label="Filter"
      hint="Captured from the search bar at the moment you opened this dialog."
    >
      <Stack gap={2}>
        <Box
          paddingX={2}
          paddingY={1.5}
          borderWidth="1px"
          borderColor="border.subtle"
          borderRadius="sm"
          bg="bg.muted"
          fontFamily="mono"
          fontSize="xs"
          color={hasFilter ? "fg" : "fg.subtle"}
          minHeight="32px"
        >
          {hasFilter ? liveFilterText : "No filter active"}
        </Box>
        <Checkbox
          size="sm"
          checked={includeFilter && hasFilter}
          disabled={!hasFilter}
          onCheckedChange={(d) => setIncludeFilter(!!d.checked)}
        >
          <Text fontSize="xs">Save the current filter with this lens</Text>
        </Checkbox>
      </Stack>
    </FieldShell>
  );
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SubmitFooter: React.FC<{
  onCancel: () => void;
  onSubmit: () => void;
}> = ({ onCancel, onSubmit }) => {
  // Subscribe to the draft (a stable reference until something actually
  // changes) and derive validity locally — calling `validate()` inside a
  // selector would return a fresh result object on every store tick.
  const draft = useLensDraftStore((s) => s.draft);
  const valid = useMemo(() => isLensDraftValid(draft), [draft]);
  return (
    <HStack gap={2}>
      <Button variant="ghost" size="sm" onClick={onCancel}>
        Cancel
      </Button>
      <Button
        colorPalette="blue"
        size="sm"
        onClick={onSubmit}
        disabled={!valid}
      >
        Create lens
      </Button>
    </HStack>
  );
};

const FieldShell: React.FC<{
  label: string;
  hint?: string;
  error?: string | null;
  children: React.ReactNode;
}> = ({ label, hint, error, children }) => (
  <Stack gap={1.5}>
    <HStack justify="space-between" align="baseline">
      <Text
        fontSize="2xs"
        fontWeight="semibold"
        color="fg.muted"
        textTransform="uppercase"
        letterSpacing="0.06em"
      >
        {label}
      </Text>
      {hint && (
        <Text fontSize="2xs" color="fg.subtle">
          {hint}
        </Text>
      )}
    </HStack>
    {children}
    {error && (
      <Text fontSize="xs" color="fg.error">
        {error}
      </Text>
    )}
  </Stack>
);

const StyledSelect = chakra("select");

const NativeSelect: React.FC<{
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  width?: StackProps["width"];
}> = ({ value, onChange, options, width }) => (
  <StyledSelect
    value={value}
    onChange={(e) => onChange(e.target.value)}
    borderWidth="1px"
    borderColor="border"
    borderRadius="sm"
    bg="bg"
    color="fg"
    paddingX={2}
    paddingY={1}
    fontSize="xs"
    width={width}
  >
    {options.map((o) => (
      <option key={o.value} value={o.value}>
        {o.label}
      </option>
    ))}
  </StyledSelect>
);

const BetaBanner: React.FC = () => (
  <Flex
    alignItems="flex-start"
    gap={2}
    paddingX={3}
    paddingY={2}
    borderWidth="1px"
    borderColor="blue.muted"
    borderRadius="sm"
    bg="blue.subtle"
    color="fg"
  >
    <Box paddingTop="2px" color="blue.fg">
      <LuInfo size={14} />
    </Box>
    <Text fontSize="xs" lineHeight="1.4">
      Lenses are stored in your browser during this beta. They won't sync
      across browsers or to teammates yet — server-backed lenses are landing
      next.
    </Text>
  </Flex>
);

function groupColumnsBySection(
  grouping: GroupingMode,
): Array<[string, LensColumnOption[]]> {
  const capability = getCapability(grouping);
  const bySection = new Map<string, LensColumnOption[]>();
  for (const col of capability.columns) {
    const key = col.section ?? "";
    const list = bySection.get(key) ?? [];
    list.push(col);
    bySection.set(key, list);
  }
  return [...bySection.entries()];
}
