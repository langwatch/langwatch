/**
 * The targeting-rules dialog: one row per rule, a scope picker and the one
 * field that scope needs, in the order the resolver reads them.
 *
 * Order is the whole point — rules are first-match-wins — so a rule can be
 * moved by pointer or by keyboard, and an added rule lands where it can still
 * fire rather than under a catch-all that answers first.
 *
 * @see specs/ops/internal-feature-flags.feature
 */

import {
  Button,
  createListCollection,
  Field,
  HStack,
  IconButton,
  Input,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Dialog } from "@langwatch/design-system/dialog";
import { Select } from "@langwatch/design-system/select";
import { Switch } from "@langwatch/design-system/switch";
import type { FeatureFlagRules } from "@langwatch/feature-flag-contract";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  findUnfillableRule,
  newRule,
  rulesToUI,
  uiToRules,
  withRuleAdded,
  withRuleMoved,
  type ScopeKind,
  type UIRule,
} from "./model/rule-editing";

const SCOPE_COLLECTION = createListCollection<{ value: ScopeKind; label: string }>({
  items: [
    { value: "EVERYONE", label: "Everyone (default)" },
    { value: "ORGANIZATION", label: "Organization" },
    { value: "PROJECT", label: "Project" },
    { value: "NEW_USERS", label: "New users" },
  ],
});

const SCOPE_FIELD_LABEL: Record<ScopeKind, string> = {
  EVERYONE: "Applies to every context",
  ORGANIZATION: "Organization id",
  PROJECT: "Project id",
  NEW_USERS: "Organization created on or after",
};

const SCOPE_FIELD_PLACEHOLDER: Record<ScopeKind, string> = {
  EVERYONE: "",
  ORGANIZATION: "organization_xxxx",
  PROJECT: "project_xxxx",
  NEW_USERS: "",
};

const MISSING_TARGET_MESSAGE: Record<ScopeKind, string> = {
  EVERYONE: "",
  ORGANIZATION: "Every organization rule needs an organization id.",
  PROJECT: "Every project rule needs a project id.",
  NEW_USERS: "Every new users rule needs a date.",
};

export function FeatureFlagRulesDialog({
  open,
  onOpenChange,
  flagKey,
  initialRules,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  flagKey: string;
  initialRules: FeatureFlagRules;
  onSave: (input: { key: string; rules: FeatureFlagRules }) => Promise<void>;
}) {
  const [draft, setDraft] = useState<UIRule[]>(() => rulesToUI(initialRules));
  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const wasOpen = useRef(false);

  // A small distance threshold on the pointer, so the grip still accepts an
  // ordinary click without the row starting to drag under it. The keyboard
  // sensor is not optional here: rule order decides which rule wins, so an
  // operator who cannot drag would be unable to say what the flag does.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Re-seed only on closed-to-open, so Cancel and reopen start from the saved
  // state, and a background refetch mid-edit does not wipe the operator's work.
  useEffect(() => {
    if (open && !wasOpen.current) {
      setDraft(rulesToUI(initialRules));
      setValidationError(null);
    }
    wasOpen.current = open;
  }, [open, initialRules]);

  const save = async () => {
    const unfillable = findUnfillableRule(draft);
    if (unfillable) {
      setValidationError(MISSING_TARGET_MESSAGE[unfillable.scopeKind]);
      return;
    }

    setSaving(true);
    try {
      await onSave({ key: flagKey, rules: uiToRules(draft) });
      onOpenChange(false);
    } catch {
      return;
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(details: { open: boolean }) => onOpenChange(details.open)}
      size="lg"
    >
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>Targeting rules</Dialog.Title>
          <Dialog.Description>
            Rules are evaluated top-to-bottom; the first match wins, and you can drag a rule by its
            handle to change that order. When no rule matches, the row toggle decides.
          </Dialog.Description>
        </Dialog.Header>
        <Dialog.Body>
          <VStack align="stretch" gap={3}>
            <Text fontFamily="mono" fontSize="xs" color="fg.muted">
              {flagKey}
            </Text>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={(event: DragEndEvent) => {
                const { active, over } = event;
                if (!over || active.id === over.id) return;
                setDraft((current) =>
                  withRuleMoved(current, { fromId: String(active.id), toId: String(over.id) }),
                );
              }}
            >
              <SortableContext
                items={draft.map((rule) => rule.id)}
                strategy={verticalListSortingStrategy}
              >
                <VStack align="stretch" gap={2}>
                  {draft.map((rule) => (
                    <RuleEditorRow
                      key={rule.id}
                      rule={rule}
                      onChange={(patch) =>
                        setDraft((current) =>
                          current.map((candidate) =>
                            candidate.id === rule.id ? { ...candidate, ...patch } : candidate,
                          ),
                        )
                      }
                      onRemove={() =>
                        setDraft((current) =>
                          current.filter((candidate) => candidate.id !== rule.id),
                        )
                      }
                    />
                  ))}
                </VStack>
              </SortableContext>
            </DndContext>
            {validationError && <Text color="fg.error">{validationError}</Text>}
            <Button
              variant="ghost"
              size="sm"
              alignSelf="flex-start"
              onClick={() => setDraft((current) => withRuleAdded(current, newRule()))}
            >
              <Plus size={14} /> Add rule
            </Button>
          </VStack>
        </Dialog.Body>
        <Dialog.Footer>
          <Dialog.ActionTrigger asChild>
            <Button variant="outline" disabled={saving}>
              Cancel
            </Button>
          </Dialog.ActionTrigger>
          <Button colorPalette="blue" loading={saving} onClick={() => void save()}>
            Save rules
          </Button>
        </Dialog.Footer>
        <Dialog.CloseTrigger />
      </Dialog.Content>
    </Dialog.Root>
  );
}

function RuleEditorRow({
  rule,
  onChange,
  onRemove,
}: {
  rule: UIRule;
  onChange: (patch: Partial<UIRule>) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: rule.id,
  });

  return (
    <HStack
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
      }}
      align="flex-end"
      gap={2}
      padding={2}
      borderWidth="1px"
      borderRadius="md"
      borderColor="border.muted"
      background="bg.panel"
      zIndex={isDragging ? 1 : void 0}
    >
      <IconButton
        aria-label="Reorder rule"
        size="sm"
        variant="ghost"
        color="fg.subtle"
        cursor="grab"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={14} />
      </IconButton>
      <Field.Root flexBasis="180px" flexShrink={0}>
        <Field.Label fontSize="xs">Scope</Field.Label>
        <Select.Root
          collection={SCOPE_COLLECTION}
          value={[rule.scopeKind]}
          onValueChange={(details: { value: string[] }) => {
            const next = details.value[0] as ScopeKind | undefined;
            if (!next) return;
            onChange({
              scopeKind: next,
              // The field beside the picker means something different per
              // scope — an id, a date, nothing — so a leftover value from the
              // previous scope would be a rule that cannot match.
              target: next === rule.scopeKind ? rule.target : "",
            });
          }}
          size="sm"
        >
          <Select.Trigger>
            <Select.ValueText placeholder="Pick scope" />
          </Select.Trigger>
          <Select.Content>
            {SCOPE_COLLECTION.items.map((item) => (
              <Select.Item key={item.value} item={item}>
                {item.label}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      </Field.Root>
      <RuleTargetField rule={rule} onChange={onChange} />
      <Field.Root flexBasis="120px" flexShrink={0}>
        <Field.Label fontSize="xs">Enabled</Field.Label>
        <HStack height="32px" alignItems="center">
          <Switch
            checked={rule.enabled}
            onCheckedChange={(details) => onChange({ enabled: details.checked })}
          />
          <Text fontSize="xs">{rule.enabled ? "on" : "off"}</Text>
        </HStack>
      </Field.Root>
      <IconButton aria-label="Remove rule" size="sm" variant="ghost" onClick={onRemove}>
        <Trash2 size={14} />
      </IconButton>
    </HStack>
  );
}

/** What the chosen scope needs beside it: an id, a date, or nothing. */
function RuleTargetField({
  rule,
  onChange,
}: {
  rule: UIRule;
  onChange: (patch: Partial<UIRule>) => void;
}) {
  const isNewUsers = rule.scopeKind === "NEW_USERS";

  return (
    <Field.Root flex={1}>
      <Field.Label fontSize="xs">{SCOPE_FIELD_LABEL[rule.scopeKind]}</Field.Label>
      <Input
        size="sm"
        type={isNewUsers ? "date" : "text"}
        fontFamily={isNewUsers ? void 0 : "mono"}
        fontSize="xs"
        placeholder={SCOPE_FIELD_PLACEHOLDER[rule.scopeKind]}
        value={rule.target}
        disabled={rule.scopeKind === "EVERYONE"}
        onChange={(event) => onChange({ target: event.target.value })}
      />
      {isNewUsers && (
        <Field.HelperText fontSize="xs">
          Matches organizations created on this date or later, so customers who signed up before it
          keep the value they already had.
        </Field.HelperText>
      )}
    </Field.Root>
  );
}
