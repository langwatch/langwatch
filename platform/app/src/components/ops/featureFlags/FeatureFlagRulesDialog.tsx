import {
  Box,
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
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  DialogActionTrigger,
  DialogBody,
  DialogCloseTrigger,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogRoot,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  SelectContent,
  SelectItem,
  SelectRoot,
  SelectTrigger,
  SelectValueText,
} from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import { toaster } from "~/components/ui/toaster";
import { showErrorToast } from "~/features/errors";
import type { FeatureFlagRules } from "~/server/featureFlag";
import { api } from "~/utils/api";
import {
  findUnfillableRule,
  newRule,
  rulesToUI,
  type ScopeKind,
  type UIRule,
  uiToRules,
  withRuleAdded,
  withRuleMoved,
} from "./ruleEditing";

const SCOPE_COLLECTION = createListCollection<{
  value: ScopeKind;
  label: string;
}>({
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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  flagKey: string;
  initialRules: FeatureFlagRules;
}) {
  const [draft, setDraft] = useState<UIRule[]>(() => rulesToUI(initialRules));
  const utils = api.useUtils();
  const setRules = api.ops.setFeatureFlagRules.useMutation({
    onSuccess: async () => {
      await utils.ops.listFeatureFlags.invalidate();
      onOpenChange(false);
    },
    onError: (error) =>
      showErrorToast({
        error,
        fallbackTitle: "Couldn't save the targeting rules",
      }),
  });

  // A pointer sensor with a small distance threshold, so the grip still
  // accepts an ordinary click without the row starting to drag under it.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // Re-seed the draft only when the dialog transitions from closed to
  // open, so a "Cancel" + reopen always starts from the saved server
  // state and doesn't leak unsaved edits between sessions. We don't
  // reset on every initialRules identity change, because a background
  // refetch while the user is mid-edit would otherwise wipe their work.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    const justOpened = open && !wasOpenRef.current;
    if (justOpened) setDraft(rulesToUI(initialRules));
    wasOpenRef.current = open;
  }, [open, initialRules]);

  const updateRule = (id: string, patch: Partial<UIRule>) => {
    setDraft((current) =>
      current.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)),
    );
  };

  const addRule = () => {
    setDraft((current) => withRuleAdded(current, newRule()));
  };

  const removeRule = (id: string) => {
    setDraft((current) => current.filter((rule) => rule.id !== id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setDraft((current) =>
      withRuleMoved(current, {
        fromId: String(active.id),
        toId: String(over.id),
      }),
    );
  };

  const handleSave = () => {
    const unfillable = findUnfillableRule(draft);
    if (unfillable) {
      toaster.create({
        title: "Missing target",
        description: MISSING_TARGET_MESSAGE[unfillable.scopeKind],
        type: "error",
      });
      return;
    }
    void setRules.mutateAsync({
      key: flagKey,
      rules: uiToRules(draft),
    });
  };

  return (
    <DialogRoot
      open={open}
      onOpenChange={(details) => onOpenChange(details.open)}
      size="lg"
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Targeting rules</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <VStack align="stretch" gap={3}>
            <Text fontSize="sm" color="fg.muted">
              Rules are evaluated top-to-bottom; the first match wins, and you
              can drag a rule by its handle to change that order. When no rule
              matches, the row-level toggle is used as the fallback. A per-flag
              env override, where one is allowed, still wins over everything
              here.
            </Text>
            <Box>
              <Text fontFamily="mono" fontSize="xs" color="fg.muted">
                {flagKey}
              </Text>
            </Box>
            {draft.length === 0 ? (
              <Box
                paddingY={6}
                paddingX={4}
                borderRadius="md"
                borderWidth="1px"
                borderStyle="dashed"
                borderColor="border.muted"
              >
                <Text fontSize="sm" color="fg.muted" textAlign="center">
                  No targeting rules. The row-level toggle decides the value for
                  everyone.
                </Text>
              </Box>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={draft.map((rule) => rule.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <VStack align="stretch" gap={2}>
                    {draft.map((rule) => (
                      <RuleRow
                        key={rule.id}
                        rule={rule}
                        onChange={(patch) => updateRule(rule.id, patch)}
                        onRemove={() => removeRule(rule.id)}
                      />
                    ))}
                  </VStack>
                </SortableContext>
              </DndContext>
            )}
            <Button
              variant="ghost"
              size="sm"
              alignSelf="flex-start"
              onClick={addRule}
            >
              <Plus size={14} /> Add rule
            </Button>
          </VStack>
        </DialogBody>
        <DialogFooter>
          <DialogActionTrigger asChild>
            <Button variant="outline" disabled={setRules.isPending}>
              Cancel
            </Button>
          </DialogActionTrigger>
          <Button
            onClick={handleSave}
            loading={setRules.isPending}
            colorPalette="blue"
          >
            Save rules
          </Button>
        </DialogFooter>
        <DialogCloseTrigger />
      </DialogContent>
    </DialogRoot>
  );
}

function RuleRow({
  rule,
  onChange,
  onRemove,
}: {
  rule: UIRule;
  onChange: (patch: Partial<UIRule>) => void;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: rule.id });
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
      borderRadius="md"
      borderWidth="1px"
      borderColor="border.muted"
      background="bg.panel"
      zIndex={isDragging ? 1 : undefined}
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
      <ScopeField rule={rule} onChange={onChange} />
      <TargetField rule={rule} onChange={onChange} />
      <Field.Root flexBasis="120px" flexShrink={0}>
        <Field.Label fontSize="xs">Enabled</Field.Label>
        <HStack height="32px" alignItems="center">
          <Switch
            checked={rule.enabled}
            onCheckedChange={(details) =>
              onChange({ enabled: details.checked })
            }
          />
          <Text fontSize="xs">{rule.enabled ? "on" : "off"}</Text>
        </HStack>
      </Field.Root>
      <IconButton
        aria-label="Remove rule"
        size="sm"
        variant="ghost"
        onClick={onRemove}
      >
        <Trash2 size={14} />
      </IconButton>
    </HStack>
  );
}

function ScopeField({
  rule,
  onChange,
}: {
  rule: UIRule;
  onChange: (patch: Partial<UIRule>) => void;
}) {
  return (
    <Field.Root flexBasis="180px" flexShrink={0}>
      <Field.Label fontSize="xs">Scope</Field.Label>
      <SelectRoot
        collection={SCOPE_COLLECTION}
        value={[rule.scopeKind]}
        onValueChange={(details) => {
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
        <SelectTrigger>
          <SelectValueText placeholder="Pick scope" />
        </SelectTrigger>
        <SelectContent>
          {SCOPE_COLLECTION.items.map((item) => (
            <SelectItem key={item.value} item={item}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </SelectRoot>
    </Field.Root>
  );
}

/** What the chosen scope needs beside it: an id, a date, or nothing. */
function TargetField({
  rule,
  onChange,
}: {
  rule: UIRule;
  onChange: (patch: Partial<UIRule>) => void;
}) {
  const isNewUsers = rule.scopeKind === "NEW_USERS";

  return (
    <Field.Root flex={1}>
      <Field.Label fontSize="xs">
        {SCOPE_FIELD_LABEL[rule.scopeKind]}
      </Field.Label>
      <Input
        size="sm"
        type={isNewUsers ? "date" : "text"}
        fontFamily={isNewUsers ? undefined : "mono"}
        fontSize="xs"
        placeholder={SCOPE_FIELD_PLACEHOLDER[rule.scopeKind]}
        value={rule.target}
        disabled={rule.scopeKind === "EVERYONE"}
        onChange={(event) => onChange({ target: event.target.value })}
      />
      {isNewUsers && (
        <Field.HelperText fontSize="xs">
          Matches organizations created on this date or later, so customers who
          signed up before it keep the value they already had.
        </Field.HelperText>
      )}
    </Field.Root>
  );
}
