/**
 * What a run plan covers: one of four rules, and the list the chosen rule
 * needs.
 *
 * A plan scoped to test suites or to labels is a rule rather than a list, so a
 * test case written tomorrow runs under it without the plan being opened
 * again. The line at the foot says how many cases the rule covers right now.
 *
 * @see specs/suites/run-plan-dynamic-scopes.feature
 * @see specs/features/agent-testing/run-plan-editor.feature
 */

import { Box, chakra, HStack, Text, VStack } from "@chakra-ui/react";
import { Folder } from "lucide-react";
import type { SuiteScopeMode } from "@langwatch/suite-contract";
import { PICKER_UNFILED_GROUP_NAME } from "~/components/suites/ScenarioPicker";
import { Checkbox } from "~/components/ui/checkbox";
import { TagPill } from "~/components/ui/TagPill";
import { FG_MUTED, QUIET_BUTTON_SHADOW } from "../shared/design";
import type { PlanEditorState } from "./usePlanEditor";

const SCOPE_CHOICES: { mode: SuiteScopeMode; label: string }[] = [
  { mode: "all", label: "All test cases" },
  { mode: "folders", label: "Selected test suites" },
  { mode: "labels", label: "Selected labels" },
  { mode: "cases", label: "Specific test cases" },
];

/** What the chosen rule needs picked. "All test cases" needs nothing. */
function ScopeDetail({ mode, editor }: { mode: SuiteScopeMode; editor: PlanEditorState }) {
  if (mode === "folders") return <FolderChoices editor={editor} />;
  if (mode === "labels") return <LabelChoices editor={editor} />;
  if (mode === "cases") return <CaseChoices editor={editor} />;
  return null;
}

/** One of the four rules, and whatever it needs picked under it. */
function ScopeChoice({
  mode,
  label,
  checked,
  onChoose,
  editor,
}: {
  mode: SuiteScopeMode;
  label: string;
  checked: boolean;
  onChoose: (mode: SuiteScopeMode) => void;
  editor: PlanEditorState;
}) {
  return (
    <Box>
      <chakra.label display="flex" alignItems="center" gap={2} fontSize="12.5px" cursor="pointer">
        <chakra.input
          type="radio"
          name="plan-scope"
          checked={checked}
          onChange={() => onChoose(mode)}
          cursor="pointer"
          accentColor="var(--chakra-colors-blue-500)"
          data-testid={`plan-scope-${mode}`}
        />
        {label}
      </chakra.label>
      {checked && mode !== "all" && (
        <Box marginTop={1.5} marginLeft={5}>
          <ScopeDetail mode={mode} editor={editor} />
        </Box>
      )}
    </Box>
  );
}

/** The test suites of the project, as check boxes. */
function FolderChoices({ editor }: { editor: PlanEditorState }) {
  const { suiteForm } = editor;
  const folders = editor.folders ?? [];
  const chosen = suiteForm.scope.mode === "folders" ? suiteForm.scope.folderIds : [];

  if (folders.length === 0) {
    return (
      <Text fontSize="11.5px" color={FG_MUTED}>
        No test suite yet. Make one in the rail on the left.
      </Text>
    );
  }

  return (
    <HStack gap={4} flexWrap="wrap" data-testid="plan-scope-suites-list">
      {folders.map((folder) => (
        <Checkbox
          key={folder.id}
          size="sm"
          checked={chosen.includes(folder.id)}
          onCheckedChange={() => suiteForm.toggleScopeFolder(folder.id)}
          data-testid={`plan-scope-folder-${folder.id}`}
        >
          <Text fontSize="12px">{folder.name}</Text>
        </Checkbox>
      ))}
    </HStack>
  );
}

/** Every label a test case of the project carries, as a chip that turns on. */
function LabelChoices({ editor }: { editor: PlanEditorState }) {
  const { suiteForm } = editor;
  const chosen = suiteForm.scope.mode === "labels" ? suiteForm.scope.labels : [];

  if (suiteForm.allLabels.length === 0) {
    return (
      <Text fontSize="11.5px" color={FG_MUTED}>
        No label on any test case yet.
      </Text>
    );
  }

  return (
    <HStack gap={1.5} flexWrap="wrap" data-testid="plan-scope-labels-list">
      {suiteForm.allLabels.map((label) => (
        <chakra.button
          key={label}
          type="button"
          cursor="pointer"
          borderRadius="full"
          boxShadow={QUIET_BUTTON_SHADOW}
          opacity={chosen.includes(label) ? 1 : 0.4}
          _hover={{ opacity: chosen.includes(label) ? 1 : 0.7 }}
          aria-pressed={chosen.includes(label)}
          onClick={() => suiteForm.toggleScopeLabel(label)}
          data-testid={`plan-scope-label-${label}`}
        >
          <TagPill label={label} tone="pastel" />
        </chakra.button>
      ))}
    </HStack>
  );
}

/** The project's test cases, read under the test suite they are filed in. */
function CaseChoices({ editor }: { editor: PlanEditorState }) {
  const { suiteForm } = editor;
  const scenarios = suiteForm.filteredScenarios;
  const folders = editor.folders ?? [];
  const filed = new Set(folders.map((folder) => folder.id));

  const groups = [
    ...folders.map((folder) => ({
      id: folder.id,
      name: folder.name,
      scenarios: scenarios.filter((scenario) => scenario.folderId === folder.id),
    })),
    {
      id: "__unfiled__",
      name: PICKER_UNFILED_GROUP_NAME,
      scenarios: scenarios.filter(
        (scenario) => !scenario.folderId || !filed.has(scenario.folderId),
      ),
    },
  ].filter((group) => group.scenarios.length > 0);

  if (groups.length === 0) {
    return (
      <Text fontSize="11.5px" color={FG_MUTED}>
        No test case yet.
      </Text>
    );
  }

  return (
    <VStack
      align="stretch"
      gap={2}
      maxHeight="160px"
      overflowY="auto"
      data-testid="plan-scope-cases-list"
    >
      {groups.map((group) => (
        <Box key={group.id}>
          <HStack gap={1.5} fontSize="11px" fontWeight="semibold" color={FG_MUTED}>
            <Folder size={11} />
            <Text>{group.name}</Text>
          </HStack>
          <VStack align="stretch" gap={0.5} paddingLeft={4} marginTop={0.5}>
            {group.scenarios.map((scenario) => (
              <Checkbox
                key={scenario.id}
                size="sm"
                checked={suiteForm.selectedScenarioIds.includes(scenario.id)}
                onCheckedChange={() => suiteForm.toggleScenario(scenario.id)}
                data-testid={`plan-scope-case-${scenario.id}`}
              >
                <Text fontSize="12px" truncate>
                  {scenario.name}
                </Text>
              </Checkbox>
            ))}
          </VStack>
        </Box>
      ))}
    </VStack>
  );
}

export function PlanScopeField({
  editor,
  hasError,
}: {
  editor: PlanEditorState;
  hasError?: boolean;
}) {
  const { suiteForm } = editor;
  const count = suiteForm.scopedScenarioIds.length;

  return (
    <VStack
      align="stretch"
      gap={2}
      borderWidth="1px"
      borderColor={hasError ? "red.500" : "border"}
      borderRadius="lg"
      paddingX={3}
      paddingY={2.5}
      data-testid="plan-scope"
    >
      {SCOPE_CHOICES.map((choice) => (
        <ScopeChoice
          key={choice.mode}
          mode={choice.mode}
          label={choice.label}
          checked={suiteForm.scope.mode === choice.mode}
          onChoose={suiteForm.setScopeMode}
          editor={editor}
        />
      ))}
      <Text paddingTop={1} fontSize="11px" color={FG_MUTED}>
        {count === 1 ? "1 test case will run." : `${count} test cases will run.`}
      </Text>
    </VStack>
  );
}
