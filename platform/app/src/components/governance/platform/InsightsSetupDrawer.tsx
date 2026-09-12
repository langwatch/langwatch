import {
  Button,
  createListCollection,
  Field,
  HStack,
  Input,
  type ListCollection,
  Separator,
  Spacer,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { UserRoundCog } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { allModelOptions, ModelSelector } from "~/components/ModelSelector";
import { Drawer } from "~/components/ui/drawer";
import { Select } from "~/components/ui/select";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { LANGY_CHAT_FEATURE_KEY } from "~/server/modelProviders/codexRestrictions";
import { api } from "~/utils/api";

/**
 * What the daily Insights job would be told, if there were a job.
 *
 * Nothing behind this drawer stores anything yet. The page owns the values
 * and hands them in; Save hands the edited copy back and closes, Cancel
 * closes and drops the edits. There is no toast and no "saved" wording on
 * purpose: a confirmation here would claim a write that never happened.
 *
 * A drawer, not a modal, on the same shell DepartmentEditDrawer uses: a
 * right-hand sheet the page stays visible behind, so the reader keeps the
 * inbox in view while they tune what fills it. Like that drawer it is
 * page-owned rather than registered in drawerRegistry: the registry can
 * only pass URL params, and this one needs the page's settings and its
 * onSave callback. The known cost is that Langy's drawer dodge keys on the
 * registry, so a floating Langy can sit over this sheet.
 *
 * The Model row is the one control already wired to something real: it
 * reads the model Langy's own routing resolves for this project (the same
 * query the Langy panel seeds its picker from) and lists the same allowed
 * models, through the shared ModelSelector. `model: null` means "whatever
 * Langy is configured with", so a change in Model Providers follows here
 * without anyone re-saving this drawer.
 *
 * Spec: specs/governance/governance-platform-placeholders.feature
 */
export interface InsightsSettings {
  runs: "daily" | "weekdays" | "weekly";
  at: string;
  volume: "langy" | "one" | "three";
  /** `provider/name`, or null to follow Langy's configured default. */
  model: string | null;
  skillInstructions: string;
}

export const DEFAULT_INSIGHTS_SETTINGS: InsightsSettings = {
  runs: "daily",
  at: "07:00",
  volume: "langy",
  model: null,
  skillInstructions: [
    "Every morning at 07:00, review yesterday's traffic across the whole substrate.",
    "",
    "- File a couple of insights at most. Insist on the issues that matter; fifteen a day is noise nobody acts on.",
    "- Write the headline in plain english. The reader should decide in one sentence whether to care.",
    "- Judge each one: good news or bad. The inbox takes its color from the balance.",
    "- Estimate how many days each insight stays true and set its validity. Let stale ones fall away.",
    "- If an open insight is still true, renew it instead of filing a duplicate.",
    "- Attach evidence: the query and chart that show it, the signal that caught it, or the traces that prove it.",
  ].join("\n"),
};

const RUNS_OPTIONS = createListCollection({
  items: [
    { value: "daily", label: "Daily" },
    { value: "weekdays", label: "Weekdays" },
    { value: "weekly", label: "Weekly" },
  ] satisfies Array<{ value: InsightsSettings["runs"]; label: string }>,
});

const VOLUME_OPTIONS = createListCollection({
  items: [
    { value: "langy", label: "Let Langy decide (recommended)" },
    { value: "one", label: "At most one a day" },
    { value: "three", label: "At most three a day" },
  ] satisfies Array<{ value: InsightsSettings["volume"]; label: string }>,
});

/** What steering would have left behind. Illustrative until there is a session. */
const LEARNED_PREFERENCES = [
  "Weekend Databricks batch load is expected: the ETL jobs moved to Saturdays in late July.",
  "Skip insights about the staging project; its traffic is synthetic.",
];

/** Label and hint over the control: a drawer is too narrow for two columns. */
function SettingRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <Field.Root paddingY={4} gap={2}>
      <VStack align="start" gap={0.5}>
        <Field.Label fontSize="sm" fontWeight="medium">
          {label}
        </Field.Label>
        <Field.HelperText fontSize="xs" color="fg.muted" marginTop={0}>
          {hint}
        </Field.HelperText>
      </VStack>
      {children}
    </Field.Root>
  );
}

export function InsightsSetupDrawer({
  open,
  settings,
  onCancel,
  onSave,
}: {
  open: boolean;
  settings: InsightsSettings;
  onCancel: () => void;
  onSave: (next: InsightsSettings) => void;
}) {
  const [draft, setDraft] = useState(settings);
  // A fresh draft every time the drawer opens: the last sitting's Cancel
  // must not leak into this one.
  useEffect(() => {
    if (open) setDraft(settings);
  }, [open, settings]);
  const patch = (next: Partial<InsightsSettings>) =>
    setDraft((current) => ({ ...current, ...next }));
  const { langyDefaultModel, modelOptions } = useLangyModelChoice({
    enabled: open,
  });

  return (
    <Drawer.Root
      open={open}
      onOpenChange={({ open: next }) => {
        if (!next) onCancel();
      }}
      placement="end"
      size="md"
    >
      <Drawer.Content bg="bg">
        <Drawer.Header>
          <VStack align="start" gap={0.5}>
            <Drawer.Title>Set up Insights</Drawer.Title>
            <Text fontSize="sm" color="fg.muted" fontWeight="normal">
              Schedule, session and skill
            </Text>
          </VStack>
          <Drawer.CloseTrigger />
        </Drawer.Header>
        <Drawer.Body>
          <VStack align="stretch" gap={0} separator={<Separator />}>
            <ScheduleRows draft={draft} patch={patch} />
            <SettingRow
              label="Model"
              hint={
                draft.model
                  ? "The model the eternal session runs on"
                  : "Langy's configured model. Pick another to override it here."
              }
            >
              <ModelSelector
                model={draft.model ?? langyDefaultModel}
                options={modelOptions}
                onChange={(model) => patch({ model })}
                size="full"
                mode="chat"
                showConfigureAction
                forFeatureLabel="for Insights"
                // Langy is a codex-licensed surface; without its key the
                // picker would drop the very model Langy may be configured
                // with and paint it as unknown.
                featureKey={LANGY_CHAT_FEATURE_KEY}
              />
            </SettingRow>
            <SessionRows draft={draft} patch={patch} />
            <LearnedPreferences />
          </VStack>
        </Drawer.Body>
        <Drawer.Footer>
          <HStack width="full">
            <Spacer />
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button colorPalette="orange" onClick={() => onSave(draft)}>
              Save
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}

/**
 * Same two queries the Langy panel seeds its own picker from: the model
 * Langy's gate resolves for this project, and the models it may use.
 * Governance is org-level and may have no project; like costs.tsx, never
 * let this hook bounce the reader to onboarding on its own.
 */
function useLangyModelChoice({ enabled }: { enabled: boolean }) {
  const { project } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  const projectId = project?.id ?? "";
  const langyDefaultQuery = api.modelProvider.getResolvedDefault.useQuery(
    { projectId, featureKey: LANGY_CHAT_FEATURE_KEY },
    { enabled: !!projectId && enabled, staleTime: 300_000 },
  );
  const modelsAllowedQuery = api.langy.modelsAllowed.useQuery(
    { projectId },
    { enabled: !!projectId && enabled, staleTime: 300_000 },
  );
  const modelOptions = useMemo(
    () => modelsAllowedQuery.data?.modelsAllowed ?? allModelOptions,
    [modelsAllowedQuery.data?.modelsAllowed],
  );
  return {
    langyDefaultModel: langyDefaultQuery.data?.model ?? "",
    modelOptions,
  };
}

type DraftProps = {
  draft: InsightsSettings;
  patch: (next: Partial<InsightsSettings>) => void;
};

/** When the job runs and how much it may file. */
function ScheduleRows({ draft, patch }: DraftProps) {
  return (
    <>
      <SettingRow
        label="Runs"
        hint="How often the background job messages Langy"
      >
        <ChoiceSelect
          collection={RUNS_OPTIONS}
          value={draft.runs}
          onChange={(runs) => patch({ runs })}
        />
      </SettingRow>
      <SettingRow label="At" hint="Europe/Amsterdam">
        <Input
          type="time"
          size="sm"
          value={draft.at}
          onChange={(event) => patch({ at: event.target.value })}
        />
      </SettingRow>
      <SettingRow
        label="Volume"
        hint="Few insights that matter beat fifteen that don't"
      >
        <ChoiceSelect
          collection={VOLUME_OPTIONS}
          value={draft.volume}
          onChange={(volume) => patch({ volume })}
        />
      </SettingRow>
    </>
  );
}

/** The eternal session and the skill it runs. */
function SessionRows({ draft, patch }: DraftProps) {
  return (
    <>
      <SettingRow
        label="Session"
        hint="One eternal conversation: every run appends, and your feedback steers it"
      >
        <HStack gap={2}>
          <Button variant="outline" size="xs">
            Open session
          </Button>
          <Button variant="ghost" size="xs" color="fg.muted">
            Clear session…
          </Button>
        </HStack>
      </SettingRow>
      <SettingRow
        label="Skill instructions"
        hint="What the daily job tells Langy. Edit it and the next run obeys."
      >
        <Textarea
          value={draft.skillInstructions}
          onChange={(event) => patch({ skillInstructions: event.target.value })}
          rows={10}
          fontSize="sm"
          lineHeight="1.6"
        />
      </SettingRow>
    </>
  );
}

/** A single-value pick from a fixed list; the repo Select under the row's Field. */
function ChoiceSelect<T extends string>({
  collection,
  value,
  onChange,
}: {
  collection: ListCollection<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <Select.Root
      collection={collection}
      size="sm"
      value={[value]}
      onValueChange={({ value: next }) => {
        const picked = next[0] as T | undefined;
        if (picked) onChange(picked);
      }}
    >
      <Select.Trigger>
        <Select.ValueText />
      </Select.Trigger>
      <Select.Content>
        {collection.items.map((item) => (
          <Select.Item key={item.value} item={item}>
            {item.label}
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  );
}

function LearnedPreferences() {
  return (
    <VStack align="stretch" gap={2} paddingY={4}>
      <HStack gap={2}>
        <UserRoundCog size={14} />
        <Text fontSize="sm" fontWeight="medium">
          Learned preferences
        </Text>
      </HStack>
      <Text fontSize="xs" color="fg.muted">
        What steering left behind. Complain about an insight and the correction
        lands here.
      </Text>
      <VStack
        align="stretch"
        gap={0}
        borderWidth="1px"
        borderColor="border.muted"
        borderRadius="md"
        separator={<Separator />}
      >
        {LEARNED_PREFERENCES.map((preference) => (
          <Text key={preference} fontSize="sm" paddingX={3} paddingY={2}>
            {preference}
          </Text>
        ))}
      </VStack>
    </VStack>
  );
}
