/**
 * One version in the history of a test case: who saved it, when, what changed,
 * and what it held.
 *
 * @see specs/features/agent-testing/case-version-history.feature
 * @see specs/scenarios/scenario-version-restore.feature
 */

import {
  Badge,
  Box,
  Button,
  HStack,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { formatTimeAgo } from "~/utils/formatTimeAgo";
import { authorOf, changeLineOf, type VersionEntry } from "./scenario-versions";
import type { VersionRestore } from "./useVersionRestore";

export type ScenarioVersionRowProps = {
  scenarioId: string;
  entry: VersionEntry;
  isCurrent: boolean;
  isMarked: boolean;
  isOpen: boolean;
  onToggleOpen: () => void;
  canRestore: boolean;
  restore: VersionRestore;
};

function VersionField({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  if (!value) return null;

  return (
    <Box>
      <Text fontSize="xs" fontWeight="medium" color="fg.muted">
        {label}
      </Text>
      <Text fontSize="xs" whiteSpace="pre-wrap">
        {value}
      </Text>
    </Box>
  );
}

/** The criteria the version held, one line each. */
function VersionCriteria({ criteria }: { criteria: string[] }) {
  if (criteria.length === 0) return null;

  return (
    <Box>
      <Text fontSize="xs" fontWeight="medium" color="fg.muted">
        Criteria
      </Text>
      <VStack align="stretch" gap={0.5} paddingTop={1}>
        {criteria.map((criterion, index) => (
          <Text key={index} fontSize="xs">
            · {criterion}
          </Text>
        ))}
      </VStack>
    </Box>
  );
}

/** What one version held, read-only. */
function VersionContent({
  scenarioId,
  version,
}: {
  scenarioId: string;
  version: number;
}) {
  const { project } = useOrganizationTeamProject();
  const { data, isLoading } = api.scenarios.getVersion.useQuery(
    { projectId: project?.id ?? "", scenarioId, version },
    { enabled: !!project?.id && !!scenarioId },
  );

  if (isLoading) {
    return (
      <HStack justify="center" paddingY={3}>
        <Spinner size="xs" />
      </HStack>
    );
  }
  if (!data) return null;

  const fields = data.fields;

  return (
    <VStack
      align="stretch"
      gap={2}
      paddingBottom={3}
      data-testid={`version-content-${version}`}
    >
      <VersionField label="Name" value={fields.name} />
      <VersionField label="Situation" value={fields.situation} />
      <VersionCriteria criteria={fields.criteria ?? []} />
      {(fields.labels ?? []).length > 0 && (
        <VersionField label="Labels" value={(fields.labels ?? []).join(", ")} />
      )}
    </VStack>
  );
}

/** The line that names the version, and opens it. */
function VersionSummary({
  entry,
  isCurrent,
  isMarked,
  isOpen,
  onToggleOpen,
}: Pick<
  ScenarioVersionRowProps,
  "entry" | "isCurrent" | "isMarked" | "isOpen" | "onToggleOpen"
>) {
  const author = authorOf(entry);

  return (
    <VStack
      as="button"
      align="start"
      gap={0}
      flex={1}
      minWidth={0}
      cursor="pointer"
      textAlign="left"
      onClick={onToggleOpen}
      aria-expanded={isOpen}
    >
      <HStack gap={2}>
        <Text fontWeight="medium" fontSize="sm">
          v{entry.version}
        </Text>
        {author && (
          <Text color="fg.muted" fontSize="sm">
            · {author}
          </Text>
        )}
        {isCurrent && (
          <Badge size="sm" colorPalette="green">
            Current
          </Badge>
        )}
        {isMarked && !isCurrent && (
          <Badge size="sm" colorPalette="blue">
            This run
          </Badge>
        )}
      </HStack>
      <Text color="fg.muted" fontSize="xs" lineClamp={2}>
        {changeLineOf(entry)} ·{" "}
        {formatTimeAgo(new Date(entry.createdAt).getTime())}
      </Text>
    </VStack>
  );
}

/** The restore control, and the confirmation it asks for first. */
function RestoreControls({
  entry,
  restore,
}: Pick<ScenarioVersionRowProps, "entry" | "restore">) {
  const isRestoring = restore.isRestoringVersion(entry.version);

  if (restore.confirmingVersion !== entry.version) {
    return (
      <Button
        size="xs"
        variant="outline"
        onClick={() => restore.ask(entry.version)}
        data-testid={`restore-${entry.version}`}
      >
        Restore
      </Button>
    );
  }

  return (
    <>
      <Button
        size="xs"
        colorPalette="orange"
        loading={isRestoring}
        onClick={() => restore.confirm(entry.version)}
        data-testid={`confirm-restore-${entry.version}`}
      >
        Restore v{entry.version}
      </Button>
      <Button
        size="xs"
        variant="ghost"
        disabled={isRestoring}
        onClick={restore.cancel}
      >
        Cancel
      </Button>
    </>
  );
}

export function ScenarioVersionRow({
  scenarioId,
  entry,
  isCurrent,
  isMarked,
  isOpen,
  onToggleOpen,
  canRestore,
  restore,
}: ScenarioVersionRowProps) {
  return (
    <VStack
      align="stretch"
      gap={0}
      borderBottom="1px solid"
      borderColor="border.muted"
      data-testid={`version-row-${entry.version}`}
    >
      <HStack align="start" justify="space-between" gap={3} paddingY={3}>
        <VersionSummary
          entry={entry}
          isCurrent={isCurrent}
          isMarked={isMarked}
          isOpen={isOpen}
          onToggleOpen={onToggleOpen}
        />

        {canRestore && !isCurrent && (
          <HStack gap={1} flexShrink={0}>
            <RestoreControls entry={entry} restore={restore} />
          </HStack>
        )}
      </HStack>

      {isOpen && !entry.isSynthesized && (
        <VersionContent scenarioId={scenarioId} version={entry.version} />
      )}
    </VStack>
  );
}
