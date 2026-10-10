import {
  createListCollection,
  Field,
  HStack,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import type React from "react";
import { useMemo } from "react";
import { HandledErrorAlert } from "~/features/errors";
import type { AggregateRule } from "~/server/app-layer/projects/aggregate-rule";
import { api } from "../../utils/api";
import { ProjectAvatar } from "../ProjectAvatar";
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

const GOVERN_LABEL = "What do you want to govern?";
const ALL_PERSONAL = "all-personal";
const SPECIFIC = "specific";
const DEPARTMENT_PREFIX = "department:";

type Department = { id: string; name: string };

/**
 * One choice of the rule select. `label` is the line in the list; `summary`
 * is what the trigger shows once it is picked, which names the rule in full
 * where the list leans on its group label.
 */
type RuleItem = {
  value: string;
  label: string;
  summary: string;
  group: "personal" | "projects";
};

function ruleItemsOf(departments: readonly Department[]): RuleItem[] {
  const allPersonal: RuleItem = {
    value: ALL_PERSONAL,
    label: departments.length > 0 ? "All departments" : "All personal projects",
    summary: "All personal projects (coding agents)",
    group: "personal",
  };
  return [
    allPersonal,
    ...departments.map(
      (department): RuleItem => ({
        value: `${DEPARTMENT_PREFIX}${department.id}`,
        label: department.name,
        summary: `Personal projects in ${department.name}`,
        group: "personal",
      }),
    ),
    {
      value: SPECIFIC,
      label: "Specific projects",
      summary: "Specific projects",
      group: "projects",
    },
  ];
}

function ruleValueOf(selection: AggregateMemberSelection): string {
  if (selection.mode === "specific") return SPECIFIC;
  return selection.departmentId
    ? `${DEPARTMENT_PREFIX}${selection.departmentId}`
    : ALL_PERSONAL;
}

/**
 * "What do you want to govern?" for a new aggregate (ADR-144): one select
 * picks the rule. Everyone's personal project is the default, and follows
 * people as they join and leave; an organisation with departments may narrow
 * it to one. "Specific projects" opens a second select to pick them.
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
  // A department list that is loading or cannot load leaves only the
  // organisation-wide choice, which is always valid.
  const departments = api.departments.list.useQuery(
    { organizationId },
    { enabled: !!organizationId, refetchOnWindowFocus: false },
  );
  const items = useMemo(
    () => ruleItemsOf(departments.data ?? []),
    [departments.data],
  );
  const collection = useMemo(() => createListCollection({ items }), [items]);
  const department =
    value.mode === "personal" && value.departmentId
      ? departments.data?.find((d) => d.id === value.departmentId)
      : undefined;

  const choose = (next: string | undefined) => {
    if (!next || next === ruleValueOf(value)) return;
    if (next === SPECIFIC)
      return onChange({ mode: "specific", projectIds: [] });
    onChange({
      mode: "personal",
      departmentId: next.startsWith(DEPARTMENT_PREFIX)
        ? next.slice(DEPARTMENT_PREFIX.length)
        : null,
    });
  };

  return (
    <VStack align="stretch" gap={3}>
      <Field.Root>
        <Field.Label>{GOVERN_LABEL}</Field.Label>
        <Select.Root
          collection={collection}
          value={[ruleValueOf(value)]}
          onValueChange={({ value: [next] }) => choose(next)}
        >
          <Select.Trigger aria-label={GOVERN_LABEL}>
            <Select.ValueText placeholder="All personal projects (coding agents)">
              {(chosen) => (chosen[0] as RuleItem | undefined)?.summary ?? ""}
            </Select.ValueText>
          </Select.Trigger>
          <Select.Content>
            <Select.ItemGroup label="Personal projects (coding agents)">
              {items
                .filter((item) => item.group === "personal")
                .map((item) => (
                  <Select.Item key={item.value} item={item}>
                    {item.label}
                  </Select.Item>
                ))}
            </Select.ItemGroup>
            <Select.ItemGroup label="Projects">
              {items
                .filter((item) => item.group === "projects")
                .map((item) => (
                  <Select.Item key={item.value} item={item}>
                    {item.label}
                  </Select.Item>
                ))}
            </Select.ItemGroup>
          </Select.Content>
        </Select.Root>
        {value.mode === "personal" && (
          <Field.HelperText>
            {department
              ? `Personal projects of everyone in ${department.name}, including people who join later.`
              : "Everyone's personal project, including people who join later."}
          </Field.HelperText>
        )}
      </Field.Root>
      {value.mode === "specific" && (
        <SpecificProjects
          organizationId={organizationId}
          value={value.projectIds}
          onChange={(projectIds) => onChange({ mode: "specific", projectIds })}
        />
      )}
    </VStack>
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
    <Field.Root>
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
