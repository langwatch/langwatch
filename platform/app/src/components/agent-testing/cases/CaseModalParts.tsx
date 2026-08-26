/**
 * The parts of the test case dialog: its heading, the four questions it asks,
 * the blocks its chips open, and the line of actions at its foot.
 *
 * @see specs/features/agent-testing/cases-table.feature
 * @see specs/features/agent-testing/case-version-history.feature
 */

import {
  Box,
  Button,
  Grid,
  HStack,
  Input,
  NativeSelect,
  Skeleton,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { Play } from "lucide-react";
import { UNFILED_OPTION_LABEL } from "~/components/scenarios/ScenarioForm";
import { SimulationModelSelect } from "~/components/scenarios/SimulationModelSelect";
import { Drawer } from "~/components/ui/drawer";
import { FieldInfoTooltip } from "~/components/ui/FieldInfoTooltip";
import { TagList } from "~/components/ui/TagList";
import { CustomizeChips } from "../shared/CustomizeChips";
import { DIALOG_FIELD_STYLE, FieldLabel } from "../shared/DialogFields";
import { FG_MUTED } from "../shared/design";
import { RemoveBlockButton } from "../shared/RemoveBlockButton";
import { SmallButton } from "../shared/SmallButton";
import { CaseVersionHistoryPopover } from "./CaseVersionHistoryPopover";
import type { TestSuiteEntry } from "./test-cases";
import type { CaseDraft, CaseEditorState } from "./useCaseEditor";

const CASE_MODAL_SUBTITLE = "Test your agent on a critical path or edge case";

const PARAMETERS_HELP =
  "Parameters reach your agent as arguments of the function you annotated. Use them to run the same case as a free or a pro customer, in another locale, or on another model.";

/** The heading: what the dialog is for, and the way back to the versions. */
export function CaseModalHeader({
  isEditing,
  scenarioId,
  version,
  openHistoryOnOpen,
}: {
  isEditing: boolean;
  /** The case being edited, or nothing for a new one. */
  scenarioId: string | null;
  version: number | null;
  /** True when the dialog was opened from a History entry. */
  openHistoryOnOpen?: boolean;
}) {
  return (
    <Drawer.Header
      borderBottomWidth="1px"
      borderColor="border"
      paddingX={5}
      paddingY={3.5}
      display="block"
    >
      <Drawer.Title fontSize="14px" fontWeight="semibold">
        {isEditing ? "Edit test case" : "New test case"}
      </Drawer.Title>
      <Text fontSize="12px" color={FG_MUTED} marginTop={0.5}>
        {CASE_MODAL_SUBTITLE}
      </Text>
      {isEditing && scenarioId && version !== null && (
        <CaseVersionHistoryPopover
          scenarioId={scenarioId}
          version={version}
          initialOpen={openHistoryOnOpen}
        />
      )}
      <Drawer.CloseTrigger />
    </Drawer.Header>
  );
}

/** The title of the case and the suite it is filed under, on one line. */
function TitleAndSuiteRow({
  draft,
  setDraft,
  suites,
}: {
  draft: CaseDraft;
  setDraft: (update: Partial<CaseDraft>) => void;
  suites: TestSuiteEntry[];
}) {
  return (
    <Grid templateColumns="1fr 180px" gap={3}>
      <Box>
        <FieldLabel>Title</FieldLabel>
        <Input
          {...DIALOG_FIELD_STYLE}
          autoFocus
          aria-label="Title"
          placeholder="Angry customer threatens a chargeback"
          value={draft.title}
          onChange={(event) => setDraft({ title: event.target.value })}
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
  );
}

/** What the user is trying to do, and what the judge must check. */
function SituationAndRubrics({
  draft,
  setDraft,
}: {
  draft: CaseDraft;
  setDraft: (update: Partial<CaseDraft>) => void;
}) {
  return (
    <>
      <Box>
        <FieldLabel>Situation · what is the user trying to do?</FieldLabel>
        <Textarea
          {...DIALOG_FIELD_STYLE}
          rows={2}
          resize="none"
          aria-label="Situation"
          placeholder="The customer is on day three of waiting for a refund and threatens to charge back."
          value={draft.situation}
          onChange={(event) => setDraft({ situation: event.target.value })}
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
          onChange={(event) => setDraft({ rubrics: event.target.value })}
        />
        <Text marginTop={1} fontSize="11px" color={FG_MUTED}>
          The judge scores each line as pass or fail on the finished
          conversation.
        </Text>
      </Box>
    </>
  );
}

/** The declared parameters of the case, as one `name=value` line. */
function ParametersBlock({
  draft,
  setDraft,
  onRemove,
}: {
  draft: CaseDraft;
  setDraft: (update: Partial<CaseDraft>) => void;
  onRemove: () => void;
}) {
  return (
    <Box data-testid="case-parameters-block">
      <FieldLabel>
        Parameters
        <FieldInfoTooltip
          description={PARAMETERS_HELP}
          docHref="/agent-simulations/scenario-parameters"
          docLabel="How to annotate an agent"
          trigger="hover"
          testId="case-parameters-info"
        />
        <RemoveBlockButton label="Remove the parameters" onClick={onRemove} />
      </FieldLabel>
      <Input
        {...DIALOG_FIELD_STYLE}
        fontFamily="mono"
        fontSize="12px"
        aria-label="Parameters"
        placeholder="customer_plan=free, locale=de"
        value={draft.parameters}
        onChange={(event) => setDraft({ parameters: event.target.value })}
      />
    </Box>
  );
}

/** The four questions the form asks, or the skeleton they stand in as. */
export function CaseModalFields({
  editor,
  suites,
}: {
  editor: CaseEditorState;
  suites: TestSuiteEntry[];
}) {
  const { draft, setDraft } = editor;

  if (editor.isLoading) return <CaseModalSkeleton />;

  return (
    <VStack align="stretch" gap={4}>
      {editor.staleVersion !== null && (
        <StaleVersionNotice
          currentVersion={editor.staleVersion}
          onReload={editor.reloadStale}
        />
      )}
      <TitleAndSuiteRow draft={draft} setDraft={setDraft} suites={suites} />
      <SituationAndRubrics draft={draft} setDraft={setDraft} />
      <CustomizeSection editor={editor} />
    </VStack>
  );
}

/** The labels of the case, and the two ways of leaving with it saved. */
export function CaseModalFooter({ editor }: { editor: CaseEditorState }) {
  const { draft, setDraft } = editor;

  return (
    <Drawer.Footer
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
            setDraft({ labels: draft.labels.filter((_, at) => at !== index) })
          }
          onAdd={(label) => setDraft({ labels: [...draft.labels, label] })}
        />
      </HStack>
      <HStack gap={2}>
        <SmallButton
          loading={editor.isSaving}
          disabled={!!editor.problem}
          title={editor.problem ?? undefined}
          onClick={() => editor.save({ shouldRunAfterSave: false })}
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
          onClick={() => editor.save({ shouldRunAfterSave: true })}
          data-testid="case-modal-save-and-run"
        >
          <Play size={13} />
          Save &amp; Run
        </SmallButton>
      </HStack>
    </Drawer.Footer>
  );
}

/** How long the conversation may run, and how early the judge may end it. */
function TurnsBlock({
  draft,
  setDraft,
  onRemove,
}: {
  draft: CaseDraft;
  setDraft: (update: Partial<CaseDraft>) => void;
  onRemove: () => void;
}) {
  return (
    <VStack align="stretch" gap={2} data-testid="case-turns-block">
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
          <FieldLabel>
            Min turns
            <RemoveBlockButton
              label="Remove the turn limits"
              onClick={onRemove}
            />
          </FieldLabel>
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
      <Text fontSize="11px" color={FG_MUTED}>
        Max turns caps the conversation. Min turns keeps the judge from ending
        the test early.
      </Text>
    </VStack>
  );
}

/**
 * The models this case runs on. A case that overrides neither follows the
 * models of the project.
 */
function ModelsBlock({
  draft,
  setDraft,
  onRemove,
}: {
  draft: CaseDraft;
  setDraft: (update: Partial<CaseDraft>) => void;
  onRemove: () => void;
}) {
  return (
    <Grid templateColumns="1fr 1fr" gap={3} data-testid="case-models-block">
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
        <FieldLabel>
          Judge
          <RemoveBlockButton
            label="Remove the model overrides"
            onClick={onRemove}
          />
        </FieldLabel>
        <SimulationModelSelect
          value={draft.judgeModel}
          onChange={(value) => setDraft({ judgeModel: value })}
          featureKey="scenarios.judge"
          size="sm"
        />
      </Box>
    </Grid>
  );
}

/**
 * What the case can carry beyond the four questions: the parameters, the turn
 * limits and the model overrides, each behind a chip until it is asked for.
 */
function CustomizeSection({ editor }: { editor: CaseEditorState }) {
  const { draft, setDraft, customize } = editor;

  return (
    <VStack align="stretch" gap={4}>
      {customize.showParameters && (
        <ParametersBlock
          draft={draft}
          setDraft={setDraft}
          onRemove={customize.removeParameters}
        />
      )}
      {customize.showTurns && (
        <TurnsBlock
          draft={draft}
          setDraft={setDraft}
          onRemove={customize.removeTurns}
        />
      )}
      {customize.showModels && (
        <ModelsBlock
          draft={draft}
          setDraft={setDraft}
          onRemove={customize.removeModels}
        />
      )}
      <CustomizeChips
        title="Customize test case"
        chips={customize.chips}
        testId="customize-case-chips"
      />
    </VStack>
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
