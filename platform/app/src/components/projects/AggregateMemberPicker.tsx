import {
  createListCollection,
  Field,
  HStack,
  Spinner,
  Stack,
  Text,
  VStack,
} from "@chakra-ui/react";
import type React from "react";
import { useMemo } from "react";
import { HandledErrorAlert } from "~/features/errors";
import type { AggregateRule } from "~/server/app-layer/projects/aggregate-rule";
import { api } from "../../utils/api";
import { ProjectAvatar } from "../ProjectAvatar";
import { Radio, RadioGroup } from "../ui/radio";
import { Select } from "../ui/select";

type Candidate = {
  id: string;
  name: string;
  isPersonal: boolean;
  owner: { name: string | null; email: string | null } | null;
};

/**
 * What the admin answered for a new aggregate: everyone's personal project
 * (optionally one department's), or a list of specific projects. Each answer
 * is exactly one rule kind; they never mix.
 */
export type AggregateMemberSelection =
  | { mode: "personal"; departmentId: string | null }
  | { mode: "specific"; projectIds: string[] };

/** Preselected: every personal project, in every department. */
export const AGGREGATE_DEFAULT_SELECTION: AggregateMemberSelection = {
  mode: "personal",
  departmentId: null,
};

/** The rule the selection stands for (ADR-144). */
export function aggregateRuleOf(
  selection: AggregateMemberSelection,
): AggregateRule {
  if (selection.mode === "specific") {
    return { kind: "explicit", projectIds: selection.projectIds };
  }
  return selection.departmentId
    ? { kind: "personal-by-department", departmentId: selection.departmentId }
    : { kind: "all-personal" };
}

/** Whether the selection reads anything: specific projects need at least one. */
export function selectsAnyMember(selection: AggregateMemberSelection): boolean {
  return selection.mode === "personal" || selection.projectIds.length > 0;
}

/**
 * The trigger's summary: the names while they fit, then a count, so a long
 * pick never wraps the field.
 */
function summariseSelectedProjects(names: readonly string[]): string {
  if (names.length <= 2) return names.join(", ");
  return `${names.length} projects`;
}

/** The department select's value for "every department". */
const ALL_DEPARTMENTS = "all";

/**
 * "What do you want to govern?" for a new aggregate (ADR-144). Personal
 * projects is the default: it follows people as they join and leave. An
 * organisation with departments may narrow it to one. Specific projects is a
 * fixed list picked from a dropdown.
 */
export function AggregateMemberPicker({
  organizationId,
  value,
  onChange,
}: {
  organizationId: string;
  value: AggregateMemberSelection;
  onChange: (selection: AggregateMemberSelection) => void;
}): React.ReactElement {
  return (
    <Field.Root>
      <Field.Label>What do you want to govern?</Field.Label>
      <RadioGroup
        value={value.mode}
        onValueChange={({ value: mode }) => {
          if (mode === value.mode) return;
          onChange(
            mode === "specific"
              ? { mode: "specific", projectIds: [] }
              : AGGREGATE_DEFAULT_SELECTION,
          );
        }}
      >
        <Stack gap={3} align="stretch">
          <VStack align="stretch" gap={2}>
            <Radio value="personal">Personal projects (coding agents)</Radio>
            <Text fontSize="sm" color="fg.muted" paddingStart={6}>
              Everyone's personal project, including people who join later.
            </Text>
            {value.mode === "personal" && (
              <DepartmentSelect
                organizationId={organizationId}
                value={value.departmentId}
                onChange={(departmentId) =>
                  onChange({ mode: "personal", departmentId })
                }
              />
            )}
          </VStack>
          <VStack align="stretch" gap={2}>
            <Radio value="specific">Specific projects</Radio>
            {value.mode === "specific" && (
              <SpecificProjects
                organizationId={organizationId}
                value={value.projectIds}
                onChange={(projectIds) =>
                  onChange({ mode: "specific", projectIds })
                }
              />
            )}
          </VStack>
        </Stack>
      </RadioGroup>
    </Field.Root>
  );
}

/**
 * Narrows the personal rule to one department. Shown only when the
 * organisation has departments: with none there is nothing to narrow to, and
 * a list that cannot load leaves the default, every department, in place.
 */
function DepartmentSelect({
  organizationId,
  value,
  onChange,
}: {
  organizationId: string;
  value: string | null;
  onChange: (departmentId: string | null) => void;
}): React.ReactElement | null {
  const departments = api.departments.list.useQuery(
    { organizationId },
    { enabled: !!organizationId, refetchOnWindowFocus: false },
  );
  const collection = useMemo(
    () =>
      createListCollection({
        items: [
          { value: ALL_DEPARTMENTS, label: "All departments" },
          ...(departments.data ?? []).map((department) => ({
            value: department.id,
            label: department.name,
          })),
        ],
      }),
    [departments.data],
  );

  if (!departments.data || departments.data.length === 0) return null;

  return (
    <Field.Root paddingStart={6}>
      <Select.Root
        collection={collection}
        value={[value ?? ALL_DEPARTMENTS]}
        onValueChange={({ value: [next] }) =>
          onChange(!next || next === ALL_DEPARTMENTS ? null : next)
        }
      >
        <Select.Trigger aria-label="Department">
          <Select.ValueText placeholder="All departments" />
        </Select.Trigger>
        <Select.Content>
          {collection.items.map((item) => (
            <Select.Item key={item.value} item={item}>
              {item.label}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
    </Field.Root>
  );
}

type CandidateItem = { value: string; label: string };

const toItem = (candidate: Candidate): CandidateItem => ({
  value: candidate.id,
  label: candidate.name,
});

/** Whose workspace a personal project is: the owner's email, else their name. */
function ownerOf(candidate: Candidate): string | null {
  if (!candidate.isPersonal) return null;
  return candidate.owner?.email || candidate.owner?.name || null;
}

/**
 * The fixed list: every project an aggregate may read, personal projects and
 * LLMOps projects in two groups. Personal is the stored `Project.isPersonal`
 * flag, never a guess from a name; the server has already left out the kinds
 * an aggregate never reads.
 */
function SpecificProjects({
  organizationId,
  value,
  onChange,
}: {
  organizationId: string;
  value: string[];
  onChange: (projectIds: string[]) => void;
}): React.ReactElement {
  const candidates = api.project.aggregateMemberCandidates.useQuery(
    { organizationId },
    { enabled: !!organizationId },
  );
  const groups = useMemo(() => {
    const all = candidates.data ?? [];
    return {
      personal: all.filter((candidate) => candidate.isPersonal),
      llmOps: all.filter((candidate) => !candidate.isPersonal),
    };
  }, [candidates.data]);
  const collection = useMemo(
    () =>
      createListCollection({
        items: [...groups.personal, ...groups.llmOps].map(toItem),
      }),
    [groups],
  );

  if (candidates.error) {
    return (
      <HandledErrorAlert
        error={candidates.error}
        fallbackTitle="Couldn't list this organization's projects"
      />
    );
  }
  if (!candidates.data) return <Spinner size="sm" />;

  return (
    <Field.Root paddingStart={6}>
      <Select.Root
        collection={collection}
        multiple
        value={value}
        onValueChange={(details) => onChange(details.value)}
      >
        <Select.Trigger aria-label="Projects">
          <Select.ValueText placeholder="Select projects">
            {(items) =>
              summariseSelectedProjects(
                items.map((item) => (item as CandidateItem).label),
              )
            }
          </Select.ValueText>
        </Select.Trigger>
        <Select.Content>
          <CandidateGroup
            label="Personal projects"
            candidates={groups.personal}
          />
          <CandidateGroup label="LLMOps projects" candidates={groups.llmOps} />
        </Select.Content>
      </Select.Root>
      {value.length === 0 && (
        <Field.HelperText>Pick at least one project.</Field.HelperText>
      )}
    </Field.Root>
  );
}

function CandidateGroup({
  label,
  candidates,
}: {
  label: string;
  candidates: Candidate[];
}): React.ReactElement {
  return (
    <Select.ItemGroup label={label}>
      {candidates.length === 0 ? (
        <Text fontSize="sm" color="fg.muted" paddingX={2} paddingY={1}>
          No projects
        </Text>
      ) : (
        candidates.map((candidate) => (
          <Select.Item key={candidate.id} item={toItem(candidate)}>
            <HStack gap={2} minWidth={0}>
              <ProjectAvatar name={candidate.name} />
              <Select.ItemText>{candidate.name}</Select.ItemText>
              {ownerOf(candidate) && (
                <Text fontSize="sm" color="fg.muted" truncate>
                  {ownerOf(candidate)}
                </Text>
              )}
            </HStack>
          </Select.Item>
        ))
      )}
    </Select.ItemGroup>
  );
}
