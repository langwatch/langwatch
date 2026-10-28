import { Dialog } from "@langwatch/design-system/dialog";
import {
  Box,
  Button,
  createListCollection,
  HStack,
  IconButton,
  Input,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { Select } from "@langwatch/design-system/select";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { checkEvaluatorLabel } from "@langwatch/evaluator-contract";
import { Info, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import type { useEvaluatorVersions } from "../../behavior/use-evaluator-versions.ts";

type EvaluatorVersionsState = ReturnType<typeof useEvaluatorVersions>;

const ROW_BOX = {
  borderWidth: "1px",
  borderColor: "border",
  borderRadius: "lg",
  paddingX: 4,
  paddingY: 3,
} as const;

function Dot({ assigned }: { assigned: boolean }) {
  return (
    <Box
      width="10px"
      height="10px"
      borderRadius="full"
      bg={assigned ? "green.solid" : "bg.emphasized"}
      flexShrink={0}
    />
  );
}

function VersionText({ version, message }: { version: number; message: string | null }) {
  return (
    <HStack gap={2} maxWidth="100%" overflow="hidden">
      <Text as="span" fontFamily="mono" fontSize="sm" fontWeight="semibold" flexShrink={0}>
        v{version}
      </Text>
      {message && (
        <Text as="span" fontSize="sm" color="fg.muted" truncate>
          {message}
        </Text>
      )}
    </HStack>
  );
}

function LabelRow({ state, label }: { state: EvaluatorVersionsState; label: string }) {
  const items = useMemo(
    () =>
      state.versions.map((row) => ({
        value: String(row.version),
        label: `v${row.version}`,
        version: row.version,
        message: row.commitMessage,
      })),
    [state.versions],
  );
  const collection = useMemo(() => createListCollection({ items }), [items]);
  const selected = state.selections[label] ?? null;

  return (
    <Box {...ROW_BOX}>
      <HStack justify="space-between" gap={3}>
        <HStack gap={3} flexShrink={0}>
          <Dot assigned={selected !== null} />
          <Text fontWeight="medium" fontSize="sm">
            {label}
          </Text>
        </HStack>
        <HStack gap={2} flex="1" minWidth={0} justify="flex-end">
          <Select.Root
            collection={collection}
            size="sm"
            flex="1"
            minWidth={0}
            maxWidth="280px"
            value={selected === null ? [] : [String(selected)]}
            onValueChange={(details) => {
              const value = details.value[0];
              state.select(label, value ? Number(value) : null);
            }}
            aria-label={`${label} version`}
          >
            <Select.Trigger clearable data-testid={`evaluator-deploy-label-trigger-${label}`}>
              <Select.ValueText placeholder="Select version">
                {(picked) => {
                  const item = picked[0] as (typeof items)[number] | undefined;
                  return item ? (
                    <VersionText version={item.version} message={item.message} />
                  ) : (
                    "Select version"
                  );
                }}
              </Select.ValueText>
            </Select.Trigger>
            <Select.Content>
              {items.map((item) => (
                <Select.Item
                  key={item.value}
                  item={item}
                  data-testid={`evaluator-deploy-label-${label}-version-${item.version}`}
                >
                  <VersionText version={item.version} message={item.message} />
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
          <IconButton
            variant="ghost"
            size="xs"
            aria-label={`Remove label ${label}`}
            disabled={selected === null}
            onClick={() => state.select(label, null)}
          >
            <Trash2 size={14} />
          </IconButton>
        </HStack>
      </HStack>
    </Box>
  );
}

/** `name` is null while the add button shows; the dialog leaves Escape to the open input. */
function AddLabel({
  state,
  name,
  setName,
}: {
  state: EvaluatorVersionsState;
  name: string | null;
  setName: (name: string | null) => void;
}) {
  const check = name ? checkEvaluatorLabel(name) : null;
  if (name === null) {
    return (
      <Button variant="ghost" size="sm" alignSelf="flex-start" onClick={() => setName("")}>
        + Add label
      </Button>
    );
  }
  const add = () => {
    if (!check?.valid) return;
    state.addLabel(name);
    setName(null);
  };
  return (
    <VStack align="stretch" gap={1}>
      <HStack gap={2}>
        <Input
          size="sm"
          placeholder="Label name (e.g. canary)"
          value={name}
          onChange={(event) => setName(event.target.value.trim())}
          onKeyDown={(event) => {
            if (event.key === "Enter") add();
            if (event.key === "Escape") setName(null);
          }}
        />
        <Button size="sm" colorPalette="orange" disabled={!check?.valid} onClick={add}>
          Add
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setName(null)}>
          Cancel
        </Button>
      </HStack>
      {check && !check.valid && name !== "" && (
        <Text fontSize="xs" color="red.fg">
          {check.reason}
        </Text>
      )}
    </VStack>
  );
}

/** Points deploy labels at versions; `latest` always follows the newest one. */
export function EvaluatorDeployDialog({
  open,
  onClose,
  evaluatorName,
  state,
}: {
  open: boolean;
  onClose: () => void;
  evaluatorName: string;
  state: EvaluatorVersionsState;
}) {
  const [newLabel, setNewLabel] = useState<string | null>(null);
  const close = () => {
    setNewLabel(null);
    state.resetSelections();
    onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      closeOnEscape={newLabel === null}
      title={`Deploy ${evaluatorName}`}
      primaryAction={{
        label: "Save",
        loading: state.isSaving,
        onClick: () => void state.save().then((saved) => saved && onClose()),
        "data-testid": "evaluator-deploy-save",
      }}
    >
      <VStack align="stretch" gap={4}>
        <Text fontSize="sm" color="fg.muted">
          Labels pin the version that experiments, the SDK and the API run. Ask for an evaluator
          with its label, such as production, to get that version instead of the latest.
        </Text>
        <VStack align="stretch" gap={3}>
          <Box {...ROW_BOX}>
            <HStack justify="space-between">
              <HStack gap={3}>
                <Dot assigned />
                <Text fontWeight="medium" fontSize="sm">
                  latest
                </Text>
              </HStack>
              <HStack gap={2}>
                <Text fontSize="sm" color="fg.muted">
                  {state.latestVersion ? `v${state.latestVersion}` : "--"}
                </Text>
                <Tooltip content="Always points at the newest version.">
                  <Box color="fg.muted" cursor="help">
                    <Info size={14} />
                  </Box>
                </Tooltip>
              </HStack>
            </HStack>
          </Box>
          {state.labels.map((label) => (
            <LabelRow key={label} state={state} label={label} />
          ))}
          <AddLabel state={state} name={newLabel} setName={setNewLabel} />
          {state.saveError && (
            <Text fontSize="sm" color="red.fg" role="alert">
              {state.saveError}
            </Text>
          )}
        </VStack>
      </VStack>
    </Dialog>
  );
}
