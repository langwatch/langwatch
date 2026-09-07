import {
  Button,
  HStack,
  Input,
  NativeSelect,
  Separator,
  Spacer,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { UserRoundCog } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { Drawer } from "~/components/ui/drawer";

/**
 * What the daily Insights job would be told, if there were a job.
 *
 * Nothing behind this drawer stores anything yet. The page owns the values
 * and hands them in; Save hands the edited copy back and closes, Cancel
 * closes and drops the edits. There is no toast and no "saved" wording on
 * purpose: a confirmation here would claim a write that never happened.
 *
 * A drawer, not a modal, on the same shell the governance settings forms
 * use (DepartmentEditDrawer, RoutingPolicyDrawer): a right-hand sheet the
 * page stays visible behind, so the reader keeps the inbox in view while
 * they tune what fills it.
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
    <VStack align="stretch" gap={2} paddingY={4}>
      <VStack align="start" gap={0.5}>
        <Text fontSize="sm" fontWeight="medium">
          {label}
        </Text>
        <Text fontSize="xs" color="fg.muted">
          {hint}
        </Text>
      </VStack>
      {children}
    </VStack>
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
            <SettingRow
              label="Runs"
              hint="How often the background job messages Langy"
            >
              <NativeSelect.Root size="sm">
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
                size="sm"
                value={draft.at}
                onChange={(event) => patch({ at: event.target.value })}
              />
            </SettingRow>
            <SettingRow
              label="Volume"
              hint="Few insights that matter beat fifteen that don't"
            >
              <NativeSelect.Root size="sm">
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
              {/* One option and nothing to write it to: read-only, not a
                  controlled field pretending to accept a change. */}
              <NativeSelect.Root size="sm" disabled>
                <NativeSelect.Field
                  aria-label="Model"
                  defaultValue={draft.model}
                >
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
                aria-label="Skill instructions"
                value={draft.skillInstructions}
                onChange={(event) =>
                  patch({ skillInstructions: event.target.value })
                }
                rows={10}
                fontSize="sm"
                lineHeight="1.6"
              />
            </SettingRow>
            <VStack align="stretch" gap={2} paddingY={4}>
              <HStack gap={2}>
                <UserRoundCog size={14} />
                <Text fontSize="sm" fontWeight="medium">
                  Learned preferences
                </Text>
              </HStack>
              <Text fontSize="xs" color="fg.muted">
                What steering left behind. Complain about an insight and the
                correction lands here.
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
                  <Text
                    key={preference}
                    fontSize="sm"
                    paddingX={3}
                    paddingY={2}
                  >
                    {preference}
                  </Text>
                ))}
              </VStack>
            </VStack>
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
