/**
 * What a run covers, asked only where it is actually being chosen.
 *
 * A run started from a scenario, a test suite or Run all already knows its
 * scope, so this block is drawn for the New run plan entry point alone.
 *
 * A scope is a rule rather than a list: a run scoped to test suites or to
 * labels picks up a scenario written tomorrow without being opened again.
 *
 * @see specs/suites/run-plan-dynamic-scopes.feature
 * @see specs/features/agent-testing/run-dialog.feature
 */

import { Box, chakra, HStack, Text, VStack } from "@chakra-ui/react";
import { Folder } from "lucide-react";
import { PICKER_UNFILED_GROUP_NAME } from "~/components/suites/ScenarioPicker";
import { Checkbox } from "~/components/ui/checkbox";
import { TagPill } from "~/components/ui/TagPill";
import { FieldLabel } from "../shared/DialogFields";
import { FG_MUTED, QUIET_BUTTON_SHADOW } from "../shared/design";
import type { RunScope } from "./run-configuration";

/** A test suite the scope can name. */
export type ScopeTestSuite = { id: string; name: string };

/** A scenario the scope can name, or count. */
export type ScopeScenario = {
  id: string;
  name: string;
  testSuiteId: string | null;
  labels: string[];
};

const SCOPE_CHOICES: { mode: RunScope["mode"]; label: string }[] = [
  { mode: "all", label: "All scenarios" },
  { mode: "test_suites", label: "Selected test suites" },
  { mode: "labels", label: "Selected labels" },
  { mode: "scenarios", label: "Specific scenarios" },
];

/** The empty rule of each mode, so switching mode starts from nothing picked. */
function emptyScopeOf(mode: RunScope["mode"]): RunScope {
  if (mode === "test_suites") return { mode: "test_suites", testSuiteIds: [] };
  if (mode === "labels") return { mode: "labels", labels: [] };
  if (mode === "scenarios") return { mode: "scenarios", scenarioIds: [] };
  return { mode: "all" };
}

/** One value on or off a list, whichever it currently is. */
function toggled(values: readonly string[], value: string): string[] {
  return values.includes(value)
    ? values.filter((entry) => entry !== value)
    : [...values, value];
}

/** Every label any scenario of the project carries, once each, in order. */
export function collectScopeLabels(
  scenarios: readonly ScopeScenario[],
): string[] {
  return [...new Set(scenarios.flatMap((scenario) => scenario.labels))].sort();
}

/** The scenarios a rule covers right now. */
export function scenariosInScope({
  scope,
  scenarios,
}: {
  scope: RunScope;
  scenarios: readonly ScopeScenario[];
}): string[] {
  if (scope.mode === "all") return scenarios.map((scenario) => scenario.id);
  if (scope.mode === "scenarios") return [...scope.scenarioIds];
  if (scope.mode === "test_suites") {
    return scenarios
      .filter(
        (scenario) =>
          !!scenario.testSuiteId &&
          scope.testSuiteIds.includes(scenario.testSuiteId),
      )
      .map((scenario) => scenario.id);
  }
  return scenarios
    .filter((scenario) =>
      scenario.labels.some((label) => scope.labels.includes(label)),
    )
    .map((scenario) => scenario.id);
}

/** The test suites of the project, as check boxes. */
function TestSuiteChoices({
  testSuites,
  chosen,
  onToggle,
}: {
  testSuites: readonly ScopeTestSuite[];
  chosen: readonly string[];
  onToggle: (testSuiteId: string) => void;
}) {
  if (testSuites.length === 0) {
    return (
      <Text fontSize="11.5px" color={FG_MUTED}>
        No test suite yet. Make one in the rail on the left.
      </Text>
    );
  }

  return (
    <HStack gap={4} flexWrap="wrap" data-testid="run-scope-suites-list">
      {testSuites.map((testSuite) => (
        <Checkbox
          key={testSuite.id}
          size="sm"
          checked={chosen.includes(testSuite.id)}
          onCheckedChange={() => onToggle(testSuite.id)}
          data-testid={`run-scope-test-suite-${testSuite.id}`}
        >
          <Text fontSize="12px">{testSuite.name}</Text>
        </Checkbox>
      ))}
    </HStack>
  );
}

/** Every label a scenario carries, as a chip that turns on. */
function LabelChoices({
  labels,
  chosen,
  onToggle,
}: {
  labels: readonly string[];
  chosen: readonly string[];
  onToggle: (label: string) => void;
}) {
  if (labels.length === 0) {
    return (
      <Text fontSize="11.5px" color={FG_MUTED}>
        No label on any scenario yet.
      </Text>
    );
  }

  return (
    <HStack gap={1.5} flexWrap="wrap" data-testid="run-scope-labels-list">
      {labels.map((label) => {
        const isChosen = chosen.includes(label);
        return (
          <chakra.button
            key={label}
            type="button"
            cursor="pointer"
            borderRadius="full"
            boxShadow={QUIET_BUTTON_SHADOW}
            _hover={{ opacity: isChosen ? 1 : 0.85 }}
            aria-pressed={isChosen}
            onClick={() => onToggle(label)}
            data-testid={`run-scope-label-${label}`}
          >
            <TagPill label={label} tone={isChosen ? "pastel" : "neutral"} />
          </chakra.button>
        );
      })}
    </HStack>
  );
}

/** The project's scenarios, read under the test suite they are filed in. */
function CaseChoices({
  testSuites,
  scenarios,
  chosen,
  onToggle,
}: {
  testSuites: readonly ScopeTestSuite[];
  scenarios: readonly ScopeScenario[];
  chosen: readonly string[];
  onToggle: (scenarioId: string) => void;
}) {
  const filed = new Set(testSuites.map((testSuite) => testSuite.id));
  const groups = [
    ...testSuites.map((testSuite) => ({
      id: testSuite.id,
      name: testSuite.name,
      scenarios: scenarios.filter(
        (scenario) => scenario.testSuiteId === testSuite.id,
      ),
    })),
    {
      id: "__unfiled__",
      name: PICKER_UNFILED_GROUP_NAME,
      scenarios: scenarios.filter(
        (scenario) => !scenario.testSuiteId || !filed.has(scenario.testSuiteId),
      ),
    },
  ].filter((group) => group.scenarios.length > 0);

  if (groups.length === 0) {
    return (
      <Text fontSize="11.5px" color={FG_MUTED}>
        No scenario yet.
      </Text>
    );
  }

  return (
    <VStack
      align="stretch"
      gap={2}
      maxHeight="200px"
      overflowY="auto"
      borderWidth="1px"
      borderColor="border"
      borderRadius="md"
      padding={2}
      data-testid="run-scope-cases-list"
    >
      {groups.map((group) => (
        <Box key={group.id}>
          <HStack
            gap={1.5}
            fontSize="11px"
            fontWeight="semibold"
            color={FG_MUTED}
          >
            <Folder size={11} />
            <Text>{group.name}</Text>
          </HStack>
          <VStack align="stretch" gap={0.5} paddingLeft={4} marginTop={0.5}>
            {group.scenarios.map((scenario) => (
              <Checkbox
                key={scenario.id}
                size="sm"
                checked={chosen.includes(scenario.id)}
                onCheckedChange={() => onToggle(scenario.id)}
                data-testid={`run-scope-case-${scenario.id}`}
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

/** What the chosen rule needs picked. "All scenarios" needs nothing. */
function ScopeDetail({
  scope,
  testSuites,
  scenarios,
  onChange,
}: {
  scope: RunScope;
  testSuites: readonly ScopeTestSuite[];
  scenarios: readonly ScopeScenario[];
  onChange: (scope: RunScope) => void;
}) {
  if (scope.mode === "test_suites") {
    return (
      <TestSuiteChoices
        testSuites={testSuites}
        chosen={scope.testSuiteIds}
        onToggle={(testSuiteId) =>
          onChange({
            mode: "test_suites",
            testSuiteIds: toggled(scope.testSuiteIds, testSuiteId),
          })
        }
      />
    );
  }
  if (scope.mode === "labels") {
    return (
      <LabelChoices
        labels={collectScopeLabels(scenarios)}
        chosen={scope.labels}
        onToggle={(label) =>
          onChange({ mode: "labels", labels: toggled(scope.labels, label) })
        }
      />
    );
  }
  if (scope.mode === "scenarios") {
    return (
      <CaseChoices
        testSuites={testSuites}
        scenarios={scenarios}
        chosen={scope.scenarioIds}
        onToggle={(scenarioId) =>
          onChange({
            mode: "scenarios",
            scenarioIds: toggled(scope.scenarioIds, scenarioId),
          })
        }
      />
    );
  }
  return null;
}

export function RunScopeSection({
  scope,
  testSuites,
  scenarios,
  onChange,
}: {
  scope: RunScope;
  testSuites: readonly ScopeTestSuite[];
  scenarios: readonly ScopeScenario[];
  onChange: (scope: RunScope) => void;
}) {
  const count = scenariosInScope({ scope, scenarios }).length;

  return (
    <Box>
      <FieldLabel>What runs</FieldLabel>
      <VStack
        align="stretch"
        gap={2}
        borderWidth="1px"
        borderColor="border"
        borderRadius="lg"
        paddingX={3}
        paddingY={2.5}
        data-testid="run-scope"
      >
        {SCOPE_CHOICES.map((choice) => (
          <Box key={choice.mode}>
            <chakra.label
              display="flex"
              alignItems="center"
              gap={2}
              fontSize="12.5px"
              cursor="pointer"
            >
              <chakra.input
                type="radio"
                name="run-scope"
                checked={scope.mode === choice.mode}
                onChange={() => onChange(emptyScopeOf(choice.mode))}
                cursor="pointer"
                accentColor="var(--chakra-colors-blue-500)"
                data-testid={`run-scope-${choice.mode}`}
              />
              {choice.label}
            </chakra.label>
            {scope.mode === choice.mode && choice.mode !== "all" && (
              <Box marginTop={1.5} marginLeft={5}>
                <ScopeDetail
                  scope={scope}
                  testSuites={testSuites}
                  scenarios={scenarios}
                  onChange={onChange}
                />
              </Box>
            )}
          </Box>
        ))}
        <Text paddingTop={1} fontSize="11px" color={FG_MUTED}>
          {count === 1
            ? "1 scenario will run."
            : `${count} scenarios will run.`}
        </Text>
      </VStack>
    </Box>
  );
}
