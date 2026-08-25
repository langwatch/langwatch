/**
 * Write or edit one test case, in one dialog.
 *
 * The dialog asks four questions: what the case is called, which suite it
 * belongs to, what the user is trying to do, and what the judge must check.
 * Everything a run can override sits under Advanced, so the four questions
 * stay the whole form.
 *
 * @see specs/features/agent-testing/cases-table.feature
 * @see specs/features/agent-testing/case-version-history.feature
 */

import {
  Box,
  Button,
  Collapsible,
  Grid,
  HStack,
  Input,
  NativeSelect,
  Skeleton,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { ChevronDown, ChevronRight, History, Play } from "lucide-react";
import { useState } from "react";
import { SimulationModelSelect } from "~/components/scenarios/SimulationModelSelect";
import { UNFILED_OPTION_LABEL } from "~/components/scenarios/ScenarioForm";
import { Dialog } from "~/components/ui/dialog";
import { FieldInfoTooltip } from "~/components/ui/FieldInfoTooltip";
import { TagList } from "~/components/ui/TagList";
import { FG_FAINT, FG_MUTED } from "../shared/design";
import { DIALOG_FIELD_STYLE, FieldLabel } from "../shared/DialogFields";
import { SmallButton } from "../shared/SmallButton";
import type { CaseDraft, CaseEditorState } from "./useCaseEditor";
import type { TestSuiteEntry } from "./test-cases";

/** What the dialog says a test case is for. */
export const CASE_MODAL_SUBTITLE =
  "Test your agent on a critical path or edge case";

/** What the (i) beside the parameters line explains. */
const PARAMETERS_HELP =
  "Parameters reach your agent as arguments of the function you annotated. Use them to run the same case as a free or a pro customer, in another locale, or on another model.";

export type CaseModalProps = {
  open: boolean;
  /** The case being edited, or nothing for a new one. */
  scenarioId: string | null;
  suites: TestSuiteEntry[];
  editor: CaseEditorState;
  onClose: () => void;
  /** Opens the version history of the case being edited. */
  onOpenHistory: () => void;
};

export function CaseModal({
  open,
  scenarioId,
  suites,
  editor,
  onClose,
  onOpenHistory,
}: CaseModalProps) {
  const { draft, setDraft } = editor;
  const isEditing = !!scenarioId;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={({ open: nextOpen }) => !nextOpen && onClose()}
      placement="center"
    >
      <Dialog.Content bg="bg.panel" maxWidth="640px" data-testid="case-modal">
        <Dialog.Header
          borderBottomWidth="1px"
          borderColor="border"
          paddingX={5}
          paddingY={3.5}
          display="block"
        >
          <Dialog.Title fontSize="14px" fontWeight="semibold">
            {isEditing ? "Edit test case" : "New test case"}
          </Dialog.Title>
          <Text fontSize="12px" color={FG_MUTED} marginTop={0.5}>
            {CASE_MODAL_SUBTITLE}
          </Text>
          {isEditing && editor.version !== null && (
            <Button
              position="absolute"
              top={3}
              right={11}
              size="xs"
              variant="ghost"
              fontSize="12px"
              color={FG_MUTED}
              title="Every version of this test case"
              onClick={onOpenHistory}
              data-testid="case-modal-history"
            >
              <History size={12} />v{editor.version} · History
            </Button>
          )}
          <Dialog.CloseTrigger />
        </Dialog.Header>

        <Dialog.Body paddingX={5} paddingY={4}>
          {editor.isLoading ? (
            <CaseModalSkeleton />
          ) : (
            <VStack align="stretch" gap={4}>
              {editor.staleVersion !== null && (
                <StaleVersionNotice
                  currentVersion={editor.staleVersion}
                  onReload={editor.reloadStale}
                />
              )}

              <Grid templateColumns="1fr 180px" gap={3}>
                <Box>
                  <FieldLabel>Title</FieldLabel>
                  <Input
                    {...DIALOG_FIELD_STYLE}
                    autoFocus
                    aria-label="Title"
                    placeholder="Angry customer threatens a chargeback"
                    value={draft.title}
                    onChange={(event) =>
                      setDraft({ title: event.target.value })
                    }
                  />
                </Box>
                <Box>
                  <FieldLabel>Test suite</FieldLabel>
                  <NativeSelect.Root size="sm">
                    <NativeSelect.Field
                      {...DIALOG_FIELD_STYLE}
                      aria-label="Test suite"
                      value={draft.folderId ?? ""}
                      onChange={(event) =>
                        setDraft({ folderId: event.target.value || null })
                      }
                    >
                      <option value="">{UNFILED_OPTION_LABEL}</option>
                      {suites.map((suite) => (
                        <option key={suite.id} value={suite.id}>
                          {suite.name}
                        </option>
                      ))}
                    </NativeSelect.Field>
                    <NativeSelect.Indicator />
                  </NativeSelect.Root>
                </Box>
              </Grid>

              <Box>
                <FieldLabel>
                  Situation · what is the user trying to do?
                </FieldLabel>
                <Textarea
                  {...DIALOG_FIELD_STYLE}
                  rows={2}
                  resize="none"
                  aria-label="Situation"
                  placeholder="The customer is on day three of waiting for a refund and threatens to charge back."
                  value={draft.situation}
                  onChange={(event) =>
                    setDraft({ situation: event.target.value })
                  }
                />
              </Box>

              <Box>
                <FieldLabel>Rubrics · one per line</FieldLabel>
                <Textarea
                  {...DIALOG_FIELD_STYLE}
                  rows={4}
                  resize="none"
                  aria-label="Rubrics"
                  placeholder={
                    "Keeps a calm tone\nGives the refund status without being asked twice\nDoes not promise compensation we do not offer"
                  }
                  value={draft.rubrics}
                  onChange={(event) =>
                    setDraft({ rubrics: event.target.value })
                  }
                />
                <Text marginTop={1} fontSize="11px" color={FG_FAINT}>
                  The judge scores each line as pass or fail on the finished
                  conversation.
                </Text>
              </Box>

              <Box>
                <FieldLabel>
                  Parameters · optional
                  <FieldInfoTooltip
                    description={PARAMETERS_HELP}
                    docHref="/agent-simulations/scenario-parameters"
                    docLabel="How to annotate an agent"
                    trigger="hover"
                    testId="case-parameters-info"
                  />
                </FieldLabel>
                <Input
                  {...DIALOG_FIELD_STYLE}
                  fontFamily="mono"
                  fontSize="12px"
                  aria-label="Parameters"
                  placeholder="customer_plan=free, locale=de"
                  value={draft.parameters}
                  onChange={(event) =>
                    setDraft({ parameters: event.target.value })
                  }
                />
              </Box>

              <AdvancedSection draft={draft} setDraft={setDraft} />
            </VStack>
          )}
        </Dialog.Body>

        <Dialog.Footer
          borderTopWidth="1px"
          borderColor="border"
          paddingX={5}
          paddingY={3}
          justifyContent="space-between"
          gap={5}
          flexWrap="wrap"
        >
          <HStack gap={1.5} flexWrap="wrap">
            <Text fontSize="12px" fontWeight="medium" color={FG_MUTED}>
              Labels
            </Text>
            <TagList
              labels={draft.labels}
              tone="pastel"
              onRemove={(_label, index) =>
                setDraft({
                  labels: draft.labels.filter((_, at) => at !== index),
                })
              }
              onAdd={(label) => setDraft({ labels: [...draft.labels, label] })}
            />
          </HStack>
          <HStack gap={2}>
            <SmallButton
              loading={editor.isSaving}
              disabled={!!editor.problem}
              title={editor.problem ?? undefined}
              onClick={() => editor.save({ runAfter: false })}
              data-testid="case-modal-save"
            >
              Save
            </SmallButton>
            <SmallButton
              variant="solid"
              colorPalette="blue"
              background={undefined}
              borderColor="transparent"
              loading={editor.isSaving}
              disabled={!!editor.problem}
              title={editor.problem ?? undefined}
              onClick={() => editor.save({ runAfter: true })}
              data-testid="case-modal-save-and-run"
            >
              <Play size={13} />
              Save &amp; Run
            </SmallButton>
          </HStack>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}

/**
 * What a run can override, out of the way of the four questions the form
 * asks. A case that overrides nothing follows the project's models and the
 * SDK's turn limits.
 */
function AdvancedSection({
  draft,
  setDraft,
}: {
  draft: CaseDraft;
  setDraft: (update: Partial<CaseDraft>) => void;
}) {
  const [open, setOpen] = useState(false);
  const ChevronIcon = open ? ChevronDown : ChevronRight;

  return (
    <Collapsible.Root
      open={open}
      onOpenChange={({ open: nextOpen }) => setOpen(nextOpen)}
    >
      <Collapsible.Trigger asChild>
        <HStack
          gap={1}
          cursor="pointer"
          userSelect="none"
          fontSize="11.5px"
          fontWeight="medium"
          color={FG_MUTED}
          _hover={{ color: "fg" }}
        >
          <ChevronIcon size={13} />
          <Text>Advanced</Text>
        </HStack>
      </Collapsible.Trigger>
      <Collapsible.Content>
        <VStack align="stretch" gap={3} paddingTop={3}>
          <Grid templateColumns="1fr 1fr" gap={3}>
            <Box>
              <FieldLabel>User simulator</FieldLabel>
              <SimulationModelSelect
                value={draft.simulatorModel}
                onChange={(value) => setDraft({ simulatorModel: value })}
                featureKey="scenarios.user_simulator"
                size="sm"
              />
            </Box>
            <Box>
              <FieldLabel>Judge</FieldLabel>
              <SimulationModelSelect
                value={draft.judgeModel}
                onChange={(value) => setDraft({ judgeModel: value })}
                featureKey="scenarios.judge"
                size="sm"
              />
            </Box>
          </Grid>
          <Grid templateColumns="1fr 1fr" gap={3}>
            <Box>
              <FieldLabel>Max turns</FieldLabel>
              <Input
                {...DIALOG_FIELD_STYLE}
                type="number"
                aria-label="Max turns"
                placeholder="Default: 10"
                value={draft.maxTurns ?? ""}
                onChange={(event) =>
                  setDraft({ maxTurns: toTurnCount(event.target.value) })
                }
              />
            </Box>
            <Box>
              <FieldLabel>Min turns</FieldLabel>
              <Input
                {...DIALOG_FIELD_STYLE}
                type="number"
                aria-label="Min turns"
                placeholder="Default: none"
                value={draft.minTurns ?? ""}
                onChange={(event) =>
                  setDraft({ minTurns: toTurnCount(event.target.value) })
                }
              />
            </Box>
          </Grid>
          <Text fontSize="11px" color={FG_FAINT}>
            Max turns caps the conversation. Min turns keeps the judge from
            ending the test early.
          </Text>
        </VStack>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

/** An empty turn field follows the default rather than sending a zero. */
function toTurnCount(raw: string): number | null {
  if (raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * Says the case changed since it was opened, and offers the reload.
 *
 * The refused save wrote nothing, so nothing is lost by leaving the draft as
 * it is. Reloading is the destructive choice, and the button says so.
 */
function StaleVersionNotice({
  currentVersion,
  onReload,
}: {
  currentVersion: number;
  onReload: () => void;
}) {
  return (
    <VStack
      align="start"
      gap={2}
      borderWidth="1px"
      borderColor="orange.solid"
      borderRadius="lg"
      padding={3}
      data-testid="scenario-stale-version"
    >
      <Text fontSize="13px" fontWeight="medium">
        This test case changed since it was opened
      </Text>
      <Text fontSize="11.5px" color={FG_MUTED}>
        Somebody else saved{" "}
        {currentVersion > 0 ? `version ${currentVersion}` : "a newer version"}{" "}
        while this one was open. Nothing was written, so your edits are still
        here. Reloading replaces them with the newer version, so copy anything
        you want to keep first.
      </Text>
      <Button size="xs" variant="outline" onClick={onReload}>
        Discard my edits and reload
      </Button>
    </VStack>
  );
}

/** Stands in for the form while a stored case is being read. */
function CaseModalSkeleton() {
  return (
    <VStack align="stretch" gap={4} data-testid="case-modal-skeleton">
      <Skeleton height="46px" />
      <Skeleton height="60px" />
      <Skeleton height="92px" />
    </VStack>
  );
}
