/**
 * The Agent Testing suite editor drawer.
 *
 * A suite (kind "folder") shows the same run plan questions as a run plan,
 * minus "What runs". Tabs:
 * - General: the suite name and its labels.
 * - Test cases: the cases filed under the suite, with an Add and a Remove.
 * - Simulation models: the user simulator and the judge overrides.
 * - Execution: the repeat count, matching the plan editor.
 *
 * The Test cases tab is a static list, not a picker: cases join the suite by
 * being filed there (Scenario.folderId), so an Add opens a small picker
 * dialog for cases NOT yet filed and confirming moves them to this suite.
 *
 * @see specs/features/agent-testing/suites-rail.feature
 * @see specs/features/agent-testing/run-plan-editor.feature
 * @see dev/docs/best_practices/drawers.md
 */

import {
  Box,
  chakra,
  Grid,
  HStack,
  IconButton,
  Input,
  Skeleton,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Play, Plus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SimulationModelSelect } from "~/components/scenarios/SimulationModelSelect";
import { Dialog } from "~/components/ui/dialog";
import { Drawer } from "~/components/ui/drawer";
import { TagList } from "~/components/ui/TagList";
import { toaster } from "~/components/ui/toaster";
import { showErrorToast } from "~/features/errors";
import type { SimulationSuite } from "~/generated/prisma/client";
import {
  getFlowCallbacks,
  useDrawer,
  useDrawerParams,
} from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { MAX_REPEAT_COUNT } from "~/server/suites/constants";
import { api } from "~/utils/api";
import {
  DIALOG_FIELD_STYLE,
  FieldError,
  FieldLabel,
} from "../shared/DialogFields";
import { FG_MUTED, QUIET_BUTTON_SHADOW } from "../shared/design";
import { SmallButton } from "../shared/SmallButton";

/** The key the suite editor drawer is opened under. */
export const SUITE_EDITOR_DRAWER = "agentTestingSuiteEditor" as const;

export type AgentTestingSuiteEditorDrawerProps = {
  /** The suite this drawer is open on. */
  suiteId?: string;
  onSaved?: (suite: SimulationSuite) => void;
};

type SuiteTab = "general" | "cases" | "models" | "execution";

const TABS: { id: SuiteTab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "cases", label: "Test cases" },
  { id: "models", label: "Simulation models" },
  { id: "execution", label: "Execution" },
];

export function AgentTestingSuiteEditorDrawer(
  _props: AgentTestingSuiteEditorDrawerProps,
) {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const { closeDrawer, drawerOpen } = useDrawer();
  const params = useDrawerParams();
  const utils = api.useUtils();

  const isOpen = drawerOpen(SUITE_EDITOR_DRAWER);
  const suiteId = params.suiteId ?? "";

  const callbacks = getFlowCallbacks(SUITE_EDITOR_DRAWER);

  const [tab, setTab] = useState<SuiteTab>("general");
  const [name, setName] = useState("");
  const [labels, setLabels] = useState<string[]>([]);
  const [simulatorModel, setSimulatorModel] = useState<string | null>(null);
  const [judgeModel, setJudgeModel] = useState<string | null>(null);
  const [repeatCount, setRepeatCount] = useState(1);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const { data: suite, isLoading: isSuiteLoading } =
    api.suites.getById.useQuery(
      { projectId, id: suiteId },
      { enabled: isOpen && !!projectId && !!suiteId },
    );

  const { data: scenarios } = api.scenarios.getAll.useQuery(
    { projectId },
    { enabled: isOpen && !!projectId },
  );

  useEffect(() => {
    if (!isOpen) return;
    setTab("general");
    setProblem(null);
  }, [isOpen, suiteId]);

  useEffect(() => {
    if (!isOpen || !suite) return;
    setName(suite.name);
    setLabels(suite.labels);
    setSimulatorModel(suite.simulatorModel ?? null);
    setJudgeModel(suite.judgeModel ?? null);
    setRepeatCount(suite.repeatCount);
  }, [isOpen, suite]);

  const casesInSuite = useMemo(
    () => (scenarios ?? []).filter((s) => s.folderId === suiteId),
    [scenarios, suiteId],
  );

  const casesNotInSuite = useMemo(
    () => (scenarios ?? []).filter((s) => s.folderId !== suiteId),
    [scenarios, suiteId],
  );

  const invalidate = useCallback(() => {
    void utils.suites.getById.invalidate({ projectId, id: suiteId });
    void utils.suites.folders.getAll.invalidate({ projectId });
    void utils.suites.getAll.invalidate();
    void utils.scenarios.getAll.invalidate({ projectId });
  }, [utils, projectId, suiteId]);

  const updateMutation = api.suites.update.useMutation({
    onSuccess: (saved) => {
      invalidate();
      toaster.create({ title: "Test suite updated", type: "success" });
      callbacks?.onSaved?.(saved);
      closeDrawer();
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't save the test suite" }),
  });

  const moveMutation = api.scenarios.moveToFolder.useMutation({
    onSuccess: () => {
      invalidate();
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't move the test case" }),
  });

  const runMutation = api.suites.run.useMutation({
    onSuccess: () => {
      toaster.create({ title: "Run scheduled", type: "success" });
      closeDrawer();
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't run the test suite" }),
  });

  const handleSave = useCallback(
    ({ shouldRunAfterSave }: { shouldRunAfterSave: boolean }) => {
      if (!name.trim()) {
        setProblem("A test suite needs a name.");
        setTab("general");
        return;
      }
      setProblem(null);
      updateMutation.mutate(
        {
          projectId,
          id: suiteId,
          name: name.trim(),
          labels,
          simulatorModel,
          judgeModel,
          repeatCount,
        },
        {
          onSuccess: (saved) => {
            if (shouldRunAfterSave) {
              runMutation.mutate({
                projectId,
                id: saved.id,
                idempotencyKey: crypto.randomUUID(),
              });
            }
          },
        },
      );
    },
    [
      name,
      labels,
      simulatorModel,
      judgeModel,
      repeatCount,
      projectId,
      suiteId,
      updateMutation,
      runMutation,
    ],
  );

  const handleAddCases = useCallback(
    (ids: string[]) => {
      for (const id of ids) {
        moveMutation.mutate({ projectId, scenarioId: id, folderId: suiteId });
      }
      setPickerOpen(false);
    },
    [moveMutation, projectId, suiteId],
  );

  const handleRemoveCase = useCallback(
    (scenarioId: string) => {
      moveMutation.mutate({ projectId, scenarioId, folderId: null });
    },
    [moveMutation, projectId],
  );

  const isSaving =
    updateMutation.isPending || moveMutation.isPending || runMutation.isPending;

  return (
    <Drawer.Root
      open={isOpen}
      onOpenChange={({ open }) => {
        if (!open) closeDrawer();
      }}
      placement="end"
      size="md"
    >
      <Drawer.Content bg="bg.panel" data-testid="agent-testing-suite-editor">
        <Drawer.Header
          borderBottomWidth="1px"
          borderColor="border"
          paddingX={5}
          paddingY={3.5}
          display="block"
        >
          <Drawer.Title fontSize="14px" fontWeight="semibold">
            Edit test suite
          </Drawer.Title>
          <Drawer.CloseTrigger />
        </Drawer.Header>

        <HStack
          gap={1}
          paddingX={4}
          borderBottomWidth="1px"
          borderColor="border"
        >
          {TABS.map((entry) => (
            <chakra.button
              key={entry.id}
              type="button"
              onClick={() => setTab(entry.id)}
              aria-pressed={tab === entry.id}
              marginBottom="-1px"
              paddingX={2.5}
              paddingY={2}
              fontSize="12.5px"
              cursor="pointer"
              appearance="none"
              background="transparent"
              borderRadius="0"
              boxShadow="none"
              borderWidth="0"
              borderStyle="solid"
              borderBottomWidth="2px"
              borderBottomColor={tab === entry.id ? "fg" : "transparent"}
              fontWeight={tab === entry.id ? "medium" : "normal"}
              color={tab === entry.id ? "fg" : FG_MUTED}
              _hover={{ color: "fg" }}
              data-testid={`suite-editor-tab-${entry.id}`}
            >
              {entry.label}
            </chakra.button>
          ))}
        </HStack>

        <Drawer.Body paddingX={5} paddingY={4} overflowY="auto">
          {isSuiteLoading ? (
            <VStack align="stretch" gap={4}>
              <Skeleton height="46px" />
              <Skeleton height="60px" />
              <Skeleton height="120px" />
            </VStack>
          ) : (
            <VStack align="stretch" gap={4}>
              {problem && <FieldError message={problem} />}
              {tab === "general" && (
                <GeneralTab
                  name={name}
                  onName={setName}
                  labels={labels}
                  onLabels={setLabels}
                />
              )}
              {tab === "cases" && (
                <CasesTab
                  cases={casesInSuite}
                  onAdd={() => setPickerOpen(true)}
                  onRemove={handleRemoveCase}
                />
              )}
              {tab === "models" && (
                <ModelsTab
                  simulatorModel={simulatorModel}
                  judgeModel={judgeModel}
                  onSimulator={setSimulatorModel}
                  onJudge={setJudgeModel}
                />
              )}
              {tab === "execution" && (
                <ExecutionTab
                  repeatCount={repeatCount}
                  onRepeat={setRepeatCount}
                />
              )}
            </VStack>
          )}
        </Drawer.Body>

        <Drawer.Footer
          borderTopWidth="1px"
          borderColor="border"
          paddingX={5}
          paddingY={3}
          gap={2}
        >
          <Box flex={1} />
          <chakra.button
            type="button"
            onClick={closeDrawer}
            paddingX={3}
            height="28px"
            borderRadius="lg"
            fontSize="12px"
            fontWeight="medium"
            color={FG_MUTED}
            cursor="pointer"
            boxShadow={QUIET_BUTTON_SHADOW}
            _hover={{ background: "bg.muted", color: "fg" }}
          >
            Cancel
          </chakra.button>
          <SmallButton
            loading={isSaving}
            onClick={() => handleSave({ shouldRunAfterSave: true })}
            data-testid="suite-editor-save-and-run"
          >
            <Play size={13} />
            Save &amp; Run
          </SmallButton>
          <SmallButton
            variant="solid"
            colorPalette="blue"
            background={undefined}
            borderColor="transparent"
            loading={isSaving}
            onClick={() => handleSave({ shouldRunAfterSave: false })}
            data-testid="suite-editor-save"
          >
            Save
          </SmallButton>
        </Drawer.Footer>
      </Drawer.Content>

      <AddCasesPickerDialog
        open={pickerOpen}
        cases={casesNotInSuite}
        onCancel={() => setPickerOpen(false)}
        onConfirm={handleAddCases}
      />
    </Drawer.Root>
  );
}

/** The suite name and its labels. */
function GeneralTab({
  name,
  onName,
  labels,
  onLabels,
}: {
  name: string;
  onName: (value: string) => void;
  labels: string[];
  onLabels: (labels: string[]) => void;
}) {
  return (
    <VStack align="stretch" gap={4}>
      <Box>
        <FieldLabel>Name</FieldLabel>
        <Input
          {...DIALOG_FIELD_STYLE}
          autoFocus
          aria-label="Name"
          value={name}
          onChange={(event) => onName(event.target.value)}
        />
      </Box>
      <Box>
        <FieldLabel>Labels</FieldLabel>
        <TagList
          labels={labels}
          tone="pastel"
          onRemove={(_label, index) =>
            onLabels(labels.filter((_, at) => at !== index))
          }
          onAdd={(label) => onLabels([...labels, label])}
        />
      </Box>
    </VStack>
  );
}

/** The cases filed under the suite. Add opens a picker, remove unfiles. */
function CasesTab({
  cases,
  onAdd,
  onRemove,
}: {
  cases: { id: string; name: string }[];
  onAdd: () => void;
  onRemove: (scenarioId: string) => void;
}) {
  return (
    <VStack align="stretch" gap={3} data-testid="suite-editor-cases-list">
      {cases.length === 0 ? (
        <Text fontSize="12px" color={FG_MUTED}>
          No test cases in this suite yet.
        </Text>
      ) : (
        <VStack align="stretch" gap={1}>
          {cases.map((testCase) => (
            <HStack
              key={testCase.id}
              gap={2}
              paddingX={3}
              paddingY={2}
              borderWidth="1px"
              borderColor="border.muted"
              borderRadius="md"
              data-testid={`suite-editor-case-${testCase.name}`}
            >
              <Text fontSize="12.5px" flex={1} truncate>
                {testCase.name}
              </Text>
              <IconButton
                aria-label={`Remove ${testCase.name} from this test suite`}
                variant="ghost"
                size="xs"
                onClick={() => onRemove(testCase.id)}
              >
                <X size={13} />
              </IconButton>
            </HStack>
          ))}
        </VStack>
      )}
      <SmallButton
        onClick={onAdd}
        data-testid="suite-editor-add-cases"
        alignSelf="flex-start"
      >
        <Plus size={13} />
        Add test cases
      </SmallButton>
    </VStack>
  );
}

/** The user simulator and the judge overrides. */
function ModelsTab({
  simulatorModel,
  judgeModel,
  onSimulator,
  onJudge,
}: {
  simulatorModel: string | null;
  judgeModel: string | null;
  onSimulator: (value: string | null) => void;
  onJudge: (value: string | null) => void;
}) {
  return (
    <VStack align="stretch" gap={4}>
      <Text fontSize="12px" color={FG_MUTED}>
        Choose the models that role-play the user and judge the runs. Both
        default to your project&apos;s Default model.
      </Text>
      <Grid templateColumns="1fr 1fr" gap={3}>
        <Box>
          <FieldLabel>User simulator</FieldLabel>
          <SimulationModelSelect
            featureKey="scenarios.user_simulator"
            value={simulatorModel}
            onChange={onSimulator}
            size="sm"
          />
        </Box>
        <Box>
          <FieldLabel>Judge</FieldLabel>
          <SimulationModelSelect
            featureKey="scenarios.judge"
            value={judgeModel}
            onChange={onJudge}
            size="sm"
          />
        </Box>
      </Grid>
    </VStack>
  );
}

/** How many times each scenario runs. */
function ExecutionTab({
  repeatCount,
  onRepeat,
}: {
  repeatCount: number;
  onRepeat: (value: number) => void;
}) {
  return (
    <VStack align="stretch" gap={4}>
      <Box>
        <HStack
          gap={2}
          borderWidth="1px"
          borderColor="border"
          borderRadius="lg"
          paddingX={3}
          paddingY={2.5}
          fontSize="12.5px"
        >
          <Text fontWeight="medium">Repeat count</Text>
          <Input
            {...DIALOG_FIELD_STYLE}
            type="number"
            width="56px"
            paddingX={2}
            fontSize="12px"
            aria-label="Repeat count"
            min={1}
            max={MAX_REPEAT_COUNT}
            value={repeatCount}
            onChange={(event) =>
              onRepeat(Math.max(1, Number(event.target.value) || 1))
            }
          />
          <Text color={FG_MUTED}>
            times per scenario (max {MAX_REPEAT_COUNT})
          </Text>
        </HStack>
      </Box>
    </VStack>
  );
}

/** The picker dialog for adding cases NOT currently in the suite. */
function AddCasesPickerDialog({
  open,
  cases,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  cases: { id: string; name: string }[];
  onCancel: () => void;
  onConfirm: (ids: string[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) setSelected(new Set());
  }, [open]);

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={({ open: nextOpen }) => !nextOpen && onCancel()}
      placement="center"
    >
      <Dialog.Content
        bg="bg.panel"
        maxWidth="480px"
        data-testid="suite-editor-add-cases-dialog"
      >
        <Dialog.Header
          borderBottomWidth="1px"
          borderColor="border"
          paddingX={5}
          paddingY={3.5}
        >
          <Dialog.Title fontSize="14px" fontWeight="semibold">
            Add test cases to the test suite
          </Dialog.Title>
          <Dialog.CloseTrigger />
        </Dialog.Header>
        <Dialog.Body
          paddingX={5}
          paddingY={4}
          maxHeight="50vh"
          overflowY="auto"
        >
          {cases.length === 0 ? (
            <Text fontSize="12px" color={FG_MUTED}>
              Every test case is already in this suite.
            </Text>
          ) : (
            <VStack align="stretch" gap={1}>
              {cases.map((testCase) => (
                <chakra.label
                  key={testCase.id}
                  display="flex"
                  gap={2}
                  paddingX={2.5}
                  paddingY={2}
                  borderRadius="md"
                  cursor="pointer"
                  _hover={{ background: "bg.muted" }}
                  data-testid={`suite-editor-picker-${testCase.name}`}
                >
                  <chakra.input
                    type="checkbox"
                    checked={selected.has(testCase.id)}
                    onChange={() => toggle(testCase.id)}
                  />
                  <Text fontSize="12.5px">{testCase.name}</Text>
                </chakra.label>
              ))}
            </VStack>
          )}
        </Dialog.Body>
        <Dialog.Footer
          borderTopWidth="1px"
          borderColor="border"
          paddingX={5}
          paddingY={3}
          gap={2}
        >
          <Box flex={1} />
          <chakra.button
            type="button"
            onClick={onCancel}
            paddingX={3}
            height="28px"
            borderRadius="lg"
            fontSize="12px"
            fontWeight="medium"
            color={FG_MUTED}
            cursor="pointer"
            boxShadow={QUIET_BUTTON_SHADOW}
            _hover={{ background: "bg.muted", color: "fg" }}
          >
            Cancel
          </chakra.button>
          <SmallButton
            variant="solid"
            colorPalette="blue"
            background={undefined}
            borderColor="transparent"
            disabled={selected.size === 0}
            onClick={() => onConfirm(Array.from(selected))}
            data-testid="suite-editor-add-cases-confirm"
          >
            Add selected
          </SmallButton>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}

export default AgentTestingSuiteEditorDrawer;
