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
import { Checkbox } from "../ui/checkbox";
import { Select } from "../ui/select";

type Candidate = {
  id: string;
  name: string;
  isPersonal: boolean;
  owner: { name: string | null; email: string | null } | null;
};

/**
 * What the admin picked for a new aggregate: whether it reads every personal
 * workspace, and which projects it reads besides (or instead).
 */
export type AggregateMemberSelection = {
  allPersonal: boolean;
  projectIds: string[];
};

/** Preselected: every personal workspace, nothing else named. */
export const AGGREGATE_DEFAULT_SELECTION: AggregateMemberSelection = {
  allPersonal: true,
  projectIds: [],
};

/**
 * The rule the selection stands for (ADR-144). "All personal workspaces" is
 * the all-personal rule, carrying any picked projects on top; without it the
 * picks are an explicit list.
 */
export function aggregateRuleOf(
  selection: AggregateMemberSelection,
): AggregateRule {
  const { allPersonal, projectIds } = selection;
  if (!allPersonal) return { kind: "explicit", projectIds };
  return projectIds.length > 0
    ? { kind: "all-personal", projectIds }
    : { kind: "all-personal" };
}

/** Whether the selection includes anything: an aggregate reading nothing is refused. */
export function selectsAnyMember(selection: AggregateMemberSelection): boolean {
  return selection.allPersonal || selection.projectIds.length > 0;
}

/**
 * The two groups of the dropdown. Personal is the stored `Project.isPersonal`
 * flag, the same one the all-personal rule resolves by, never a guess from a
 * name. The server has already left out the kinds an aggregate never reads.
 */
function groupAggregateCandidates<C extends { isPersonal: boolean }>(
  candidates: readonly C[],
): { personal: C[]; llmOps: C[] } {
  return {
    personal: candidates.filter((candidate) => candidate.isPersonal),
    llmOps: candidates.filter((candidate) => !candidate.isPersonal),
  };
}

/**
 * The trigger's summary: the names while they fit, then a count, so a long
 * pick never wraps the field.
 */
function summariseSelectedProjects(names: readonly string[]): string {
  if (names.length <= 2) return names.join(", ");
  return `${names.length} projects`;
}

/** Whose workspace a personal project is: the owner's email, else their name. */
function ownerOf(candidate: Candidate): string | null {
  if (!candidate.isPersonal) return null;
  return candidate.owner?.email || candidate.owner?.name || null;
}

type CandidateItem = { value: string; label: string; candidate: Candidate };

const toItem = (candidate: Candidate): CandidateItem => ({
  value: candidate.id,
  label: candidate.name,
  candidate,
});

/**
 * The members a new aggregate reads (ADR-144): every personal workspace by
 * default, which keeps joiners and leavers in step, and any projects picked
 * from the dropdown on top. Unchecking "All personal workspaces" turns the
 * dropdown into the whole list, personal workspaces included.
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
  const candidates = api.project.aggregateMemberCandidates.useQuery(
    { organizationId },
    { enabled: !!organizationId },
  );

  const groups = useMemo(
    () => groupAggregateCandidates(candidates.data ?? []),
    [candidates.data],
  );

  const setAllPersonal = (allPersonal: boolean) => {
    // The rule covers every personal workspace once this is on, so a
    // workspace picked by hand would be both hidden and named twice.
    const personalIds = new Set(groups.personal.map((c) => c.id));
    onChange({
      allPersonal,
      projectIds: allPersonal
        ? value.projectIds.filter((id) => !personalIds.has(id))
        : value.projectIds,
    });
  };

  return (
    <VStack align="stretch" gap={4}>
      <Field.Root>
        <Checkbox
          checked={value.allPersonal}
          onCheckedChange={({ checked }) => setAllPersonal(checked === true)}
        >
          All personal workspaces
        </Checkbox>
        <Field.HelperText>
          Everyone's workspace, including people who join later.
        </Field.HelperText>
      </Field.Root>

      <Field.Root>
        <Field.Label>Projects</Field.Label>
        {candidates.error ? (
          <HandledErrorAlert
            error={candidates.error}
            fallbackTitle="Couldn't list this organization's projects"
          />
        ) : !candidates.data ? (
          <Spinner size="sm" />
        ) : (
          <ProjectsSelect
            personal={value.allPersonal ? [] : groups.personal}
            llmOps={groups.llmOps}
            value={value.projectIds}
            onChange={(projectIds) => onChange({ ...value, projectIds })}
          />
        )}
        {!selectsAnyMember(value) && (
          <Field.HelperText>
            Pick at least one project, or include all personal workspaces.
          </Field.HelperText>
        )}
      </Field.Root>
    </VStack>
  );
}

function ProjectsSelect({
  personal,
  llmOps,
  value,
  onChange,
}: {
  personal: Candidate[];
  llmOps: Candidate[];
  value: string[];
  onChange: (projectIds: string[]) => void;
}): React.ReactElement {
  const collection = useMemo(
    () => createListCollection({ items: [...personal, ...llmOps].map(toItem) }),
    [personal, llmOps],
  );

  return (
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
        {personal.length > 0 && (
          <CandidateGroup label="Personal workspaces" candidates={personal} />
        )}
        <CandidateGroup label="LLMOps projects" candidates={llmOps} />
      </Select.Content>
    </Select.Root>
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
