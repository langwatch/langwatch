import { Fieldset, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import type React from "react";
import { HandledErrorAlert } from "~/features/errors";
import { api } from "../../utils/api";
import { ProjectAvatar } from "../ProjectAvatar";
import { Checkbox, CheckboxGroup } from "../ui/checkbox";

type Candidate = {
  id: string;
  name: string;
  isPersonal: boolean;
  owner: { name: string | null; email: string | null } | null;
};

/**
 * The two sections of the picker. Personal is the stored `Project.isPersonal`
 * flag, the same one the all-personal rule resolves by, never a guess from a
 * name. The server has already left out the kinds an aggregate never reads.
 */
export function groupAggregateCandidates<C extends { isPersonal: boolean }>(
  candidates: readonly C[],
): { personal: C[]; llmOps: C[] } {
  return {
    personal: candidates.filter((candidate) => candidate.isPersonal),
    llmOps: candidates.filter((candidate) => !candidate.isPersonal),
  };
}

/** Whose workspace a personal project is: the owner's name, else their email. */
function ownerLabel(candidate: Candidate): string | null {
  return candidate.owner?.name || candidate.owner?.email || null;
}

/**
 * The projects an admin picks for a new aggregate's explicit rule (ADR-144),
 * in two sections: every member's personal workspace, and every other
 * project of the organisation.
 */
export function AggregateMemberPicker({
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

  if (candidates.error) {
    return (
      <HandledErrorAlert
        error={candidates.error}
        fallbackTitle="Couldn't list this organization's projects"
      />
    );
  }
  if (!candidates.data) {
    return <Spinner size="sm" />;
  }

  const { personal, llmOps } = groupAggregateCandidates(candidates.data);

  return (
    <CheckboxGroup
      value={value}
      onValueChange={(next: string[]) => onChange(next)}
    >
      <VStack align="stretch" gap={4}>
        <CandidateSection title="Personal projects" candidates={personal} />
        <CandidateSection title="LLMOps projects" candidates={llmOps} />
      </VStack>
    </CheckboxGroup>
  );
}

function CandidateSection({
  title,
  candidates,
}: {
  title: string;
  candidates: Candidate[];
}): React.ReactElement {
  return (
    <Fieldset.Root>
      <Fieldset.Legend fontSize="sm" fontWeight="medium">
        {title}
      </Fieldset.Legend>
      {candidates.length === 0 ? (
        <Text fontSize="sm" color="fg.muted">
          No projects
        </Text>
      ) : (
        <VStack align="stretch" gap={2} paddingTop={1}>
          {candidates.map((candidate) => {
            const owner = ownerLabel(candidate);
            return (
              <Checkbox key={candidate.id} value={candidate.id}>
                <HStack gap={2}>
                  <ProjectAvatar name={candidate.name} />
                  <Text>{candidate.name}</Text>
                  {owner && (
                    <Text fontSize="sm" color="fg.muted">
                      {owner}
                    </Text>
                  )}
                </HStack>
              </Checkbox>
            );
          })}
        </VStack>
      )}
    </Fieldset.Root>
  );
}
