import {
  Box,
  Button,
  HStack,
  Input,
  NativeSelect,
  Separator,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { Sparkles, UserRoundCog } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import {
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogRoot,
  DialogTitle,
} from "~/components/ui/dialog";

/**
 * What the daily Insights job would be told, if there were a job.
 *
 * Nothing behind this dialog stores anything yet. The page owns the values
 * and hands them in; Save hands the edited copy back and closes, Cancel
 * closes and drops the edits. There is no toast and no "saved" wording on
 * purpose: a confirmation here would claim a write that never happened.
 *
 * Spec: specs/governance/governance-platform-placeholders.feature
 */
export interface InsightsSettings {
  runs: "daily" | "weekdays" | "weekly";
  at: string;
  volume: "langy" | "one" | "three";
  model: "langy-default";
  skillInstructions: string;
}

export const DEFAULT_INSIGHTS_SETTINGS: InsightsSettings = {
  runs: "daily",
  at: "07:00",
  volume: "langy",
  model: "langy-default",
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

/** What steering would have left behind. Illustrative until there is a session. */
const LEARNED_PREFERENCES = [
  "Weekend Databricks batch load is expected: the ETL jobs moved to Saturdays in late July.",
  "Skip insights about the staging project; its traffic is synthetic.",
];

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
    <HStack align="center" gap={6} paddingY={3}>
      <VStack align="start" gap={0.5} flex={1} minWidth={0}>
        <Text fontWeight="medium">{label}</Text>
        <Text fontSize="sm" color="fg.muted">
          {hint}
        </Text>
      </VStack>
      <Box flex={1} minWidth={0}>
        {children}
      </Box>
    </HStack>
  );
}

export function InsightsSetupDialog({
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
  // A fresh draft every time the dialog opens: the last sitting's Cancel
  // must not leak into this one.
  useEffect(() => {
    if (open) setDraft(settings);
  }, [open, settings]);
  const patch = (next: Partial<InsightsSettings>) =>
    setDraft((current) => ({ ...current, ...next }));

  return (
    <DialogRoot
      open={open}
      onOpenChange={({ open: next }) => {
        if (!next) onCancel();
      }}
      size="lg"
      placement="center"
    >
      <DialogContent>
        <DialogHeader>
          <HStack gap={3} align="baseline">
            <Sparkles size={18} />
            <DialogTitle>Insights</DialogTitle>
            <Text fontSize="sm" color="fg.muted">
              schedule, session and skill
            </Text>
          </HStack>
        </DialogHeader>
        <DialogBody>
          <VStack align="stretch" gap={0} separator={<Separator />}>
            <SettingRow
              label="Runs"
              hint="How often the background job messages Langy"
            >
              <NativeSelect.Root>
                <NativeSelect.Field
                  aria-label="Runs"
                  value={draft.runs}
                  onChange={(event) =>
                    patch({
                      runs: event.target.value as InsightsSettings["runs"],
                    })
                  }
                >
                  <option value="daily">Daily</option>
                  <option value="weekdays">Weekdays</option>
                  <option value="weekly">Weekly</option>
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
            </SettingRow>
            <SettingRow label="At" hint="Europe/Amsterdam">
              <Input
                aria-label="At"
                type="time"
                value={draft.at}
                onChange={(event) => patch({ at: event.target.value })}
              />
            </SettingRow>
            <SettingRow
              label="Volume"
              hint="Few insights that matter beat fifteen that don't"
            >
              <NativeSelect.Root>
                <NativeSelect.Field
                  aria-label="Volume"
                  value={draft.volume}
                  onChange={(event) =>
                    patch({
                      volume: event.target.value as InsightsSettings["volume"],
                    })
                  }
                >
                  <option value="langy">Let Langy decide (recommended)</option>
                  <option value="one">At most one a day</option>
                  <option value="three">At most three a day</option>
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
            </SettingRow>
            <SettingRow
              label="Model"
              hint="The model the eternal session runs on"
            >
              <NativeSelect.Root>
                <NativeSelect.Field aria-label="Model" value={draft.model}>
                  <option value="langy-default">
                    claude-sonnet-4.5 · Langy default
                  </option>
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
            </SettingRow>
            <SettingRow
              label="Session"
              hint="One eternal conversation: every run appends, and your feedback steers it"
            >
              <HStack gap={3}>
                <Button variant="outline" size="sm">
                  Open session
                </Button>
                <Button variant="ghost" size="sm" color="fg.muted">
                  Clear session…
                </Button>
              </HStack>
            </SettingRow>
          </VStack>

          <VStack align="stretch" gap={2} paddingTop={5}>
            <Text fontWeight="medium">Skill instructions</Text>
            <Text fontSize="sm" color="fg.muted">
              What the daily job tells Langy. Edit it and the next run obeys.
            </Text>
            <Textarea
              aria-label="Skill instructions"
              value={draft.skillInstructions}
              onChange={(event) =>
                patch({ skillInstructions: event.target.value })
              }
              rows={8}
              fontSize="sm"
              lineHeight="1.6"
            />
          </VStack>

          <VStack align="stretch" gap={2} paddingTop={5}>
            <HStack gap={2}>
              <UserRoundCog size={14} />
              <Text fontWeight="medium">Learned preferences</Text>
            </HStack>
            <Text fontSize="sm" color="fg.muted">
              What steering left behind. Complain about an insight and the
              correction lands here.
            </Text>
            <VStack
              align="stretch"
              gap={0}
              borderWidth="1px"
              borderColor="border.subtle"
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
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button colorPalette="orange" onClick={() => onSave(draft)}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  );
}
