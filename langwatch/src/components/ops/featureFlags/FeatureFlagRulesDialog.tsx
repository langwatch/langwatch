import {
  Box,
  Button,
  Field,
  HStack,
  IconButton,
  Input,
  Text,
  VStack,
  createListCollection,
} from "@chakra-ui/react";
import { Plus, Trash2 } from "lucide-react";
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
import { api } from "~/utils/api";
import type { FeatureFlagRules } from "~/server/featureFlag";

type ScopeKind = "EVERYONE" | "ORGANIZATION" | "PROJECT";

interface UIRule {
  scopeKind: ScopeKind;
  scopeId: string;
  enabled: boolean;
}

const SCOPE_COLLECTION = createListCollection<{ value: ScopeKind; label: string }>({
  items: [
    { value: "EVERYONE", label: "Everyone (default)" },
    { value: "ORGANIZATION", label: "Organization" },
    { value: "PROJECT", label: "Project" },
  ],
});

const DEFAULT_NEW_RULE: UIRule = {
  scopeKind: "ORGANIZATION",
  scopeId: "",
  enabled: true,
};

function rulesToUI(rules: FeatureFlagRules): UIRule[] {
  // Empty input → seed the dialog with one org-scoped rule so operators
  // see the shape they're about to fill in instead of an empty pane.
  if (rules.length === 0) return [DEFAULT_NEW_RULE];
  return rules.map((r) => {
    if (r.match.organizationId) {
      return {
        scopeKind: "ORGANIZATION",
        scopeId: r.match.organizationId,
        enabled: r.enabled,
      };
    }
    if (r.match.projectId) {
      return {
        scopeKind: "PROJECT",
        scopeId: r.match.projectId,
        enabled: r.enabled,
      };
    }
    return { scopeKind: "EVERYONE", scopeId: "", enabled: r.enabled };
  });
}

function uiToRules(rules: UIRule[]): FeatureFlagRules {
  return rules.map((r) => {
    const scopeId = r.scopeId.trim();
    if (r.scopeKind === "ORGANIZATION") {
      return { match: { organizationId: scopeId }, enabled: r.enabled };
    }
    if (r.scopeKind === "PROJECT") {
      return { match: { projectId: scopeId }, enabled: r.enabled };
    }
    return { match: {}, enabled: r.enabled };
  });
}

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
    onError: (error) => {
      toaster.create({
        title: "Failed to save rules",
        description: error.message,
        type: "error",
      });
    },
  });

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

  const updateRule = (index: number, patch: Partial<UIRule>) => {
    setDraft((current) =>
      current.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    );
  };

  const addRule = () => {
    setDraft((current) => [
      ...current,
      { scopeKind: "ORGANIZATION", scopeId: "", enabled: true },
    ]);
  };

  const removeRule = (index: number) => {
    setDraft((current) => current.filter((_, i) => i !== index));
  };

  const handleSave = () => {
    const invalid = draft.find(
      (r) => r.scopeKind !== "EVERYONE" && r.scopeId.trim() === "",
    );
    if (invalid) {
      toaster.create({
        title: "Missing target",
        description: `Every ${invalid.scopeKind.toLowerCase()} rule needs an ID.`,
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
              Rules are evaluated top-to-bottom; the first match wins. When
              no rule matches, the row-level toggle is used as the
              fallback. Once a row exists in postgres, PostHog is no
              longer consulted for this flag.
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
                  No targeting rules. The row-level toggle decides the
                  value for everyone.
                </Text>
              </Box>
            ) : (
              <VStack align="stretch" gap={2}>
                {draft.map((rule, index) => (
                  <RuleRow
                    key={index}
                    rule={rule}
                    onChange={(patch) => updateRule(index, patch)}
                    onRemove={() => removeRule(index)}
                  />
                ))}
              </VStack>
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
  return (
    <HStack
      align="flex-end"
      gap={2}
      padding={2}
      borderRadius="md"
      borderWidth="1px"
      borderColor="border.muted"
    >
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
              scopeId: next === "EVERYONE" ? "" : rule.scopeId,
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
      <Field.Root flex={1}>
        <Field.Label fontSize="xs">
          {rule.scopeKind === "EVERYONE"
            ? "Applies to every context"
            : `${rule.scopeKind === "ORGANIZATION" ? "Organization" : "Project"} id`}
        </Field.Label>
        <Input
          size="sm"
          fontFamily="mono"
          fontSize="xs"
          placeholder={
            rule.scopeKind === "ORGANIZATION"
              ? "organization_xxxx"
              : rule.scopeKind === "PROJECT"
                ? "project_xxxx"
                : ""
          }
          value={rule.scopeId}
          disabled={rule.scopeKind === "EVERYONE"}
          onChange={(e) => onChange({ scopeId: e.target.value })}
        />
      </Field.Root>
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
