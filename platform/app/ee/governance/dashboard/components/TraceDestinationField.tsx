// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Where a conversation source's conversations land: the project whose trace
 * explorer they become readable in.
 *
 * Spec: specs/ai-gateway/governance/ingestion-sources.feature
 * ADR-088 v7, Decisions 8-14.
 *
 * The picker is `ScopeChipPicker` in single-select PROJECT mode — the same
 * control the virtual-key ownership section drives for the same column
 * (`components/gateway/VirtualKeyOwnershipSection.tsx`), because a trace
 * destination is one concept and should not read two ways.
 *
 * What this field owes the reader beyond the picker: the three consequences
 * of the choice that no other screen states. Each is a property of the
 * mechanism, not of the copy, so each is cited to the code that makes it
 * true:
 *
 *   - the destination project's own data-privacy policy governs what is
 *     stored, resolved inside the pipeline by tenant id
 *     (`span-pii-redaction.service.ts:231-261`) — Decision 13;
 *   - only conversations from the last 31 days arrive, so a thread that
 *     started earlier renders partially (`SPAN_MAX_PAST_MS`,
 *     `trace-request-collection.service.ts:30`) — Decision 11;
 *   - a destination archived or deleted later stops receiving conversations
 *     instead of failing the source (`pullerWorker.ts:387-396`) — Decision 9.
 *
 * A destination is deliberately never seeded. Where one team's conversations
 * become readable to another is a choice someone makes, not a default they
 * inherit — the same reason the virtual-key drawer refuses to seed it.
 */

import { Badge, HStack, Text, VStack } from "@chakra-ui/react";
import { SmallLabel } from "~/components/SmallLabel";
import { ScopeChipPicker } from "~/components/settings/ScopeChipPicker";
import { FieldInfoTooltip } from "~/components/ui/FieldInfoTooltip";
import { routesConversations, type SourceType } from "./ingestionSourceCatalog";

/**
 * Says the stored destination is gone, in the one wording that distinguishes
 * "archived" from "never set" — an admin who reads the second goes looking
 * for a choice they never made, instead of restoring a project they did.
 */
function ArchivedDestinationNotice() {
  return (
    <HStack gap={1.5} alignItems="center">
      <Text
        fontSize="xs"
        color="fg.muted"
        data-testid="ingestion-trace-destination-archived"
      >
        This source&rsquo;s destination project has been archived, so its
        conversations are no longer being routed anywhere. Restore that project,
        or pick another destination below, to start again.
      </Text>
      <Badge size="sm" colorPalette="orange" variant="subtle">
        Archived
      </Badge>
    </HStack>
  );
}

/**
 * The three consequences of having picked a destination, plus the fourth that
 * only exists once the source has a history. Each is a property of the
 * pipeline rather than of this screen, so each is cited in the file header to
 * the code that makes it true.
 */
function PickedDestinationConsequences({ mode }: { mode: "create" | "edit" }) {
  return (
    <>
      <Text
        fontSize="xs"
        color="fg.muted"
        data-testid="ingestion-trace-destination-redaction"
      >
        That project&rsquo;s data-privacy policy governs what is stored —
        conversations are redacted on its terms, not this source&rsquo;s.
      </Text>
      <Text
        fontSize="xs"
        color="fg.muted"
        data-testid="ingestion-trace-destination-horizon"
      >
        Conversations from the last 31 days arrive. A conversation that started
        before then shows only its more recent turns; the older ones are not
        stored.
      </Text>
      <Text
        fontSize="xs"
        color="fg.muted"
        data-testid="ingestion-trace-destination-archival"
      >
        If that project is later archived or deleted, this source stops
        receiving conversations rather than failing or landing them elsewhere.
      </Text>
      {mode === "edit" && (
        <Text
          fontSize="xs"
          color="fg.muted"
          data-testid="ingestion-trace-destination-history"
        >
          Conversations already routed stay where they are. Changing the
          destination moves nothing that has landed.
        </Text>
      )}
    </>
  );
}

export type TraceDestinationFieldProps = {
  sourceType: SourceType;
  /** The source's `traceProjectId`. Null means don't route. */
  value: string | null;
  onChange: (next: string | null) => void;
  /**
   * `edit` adds the two sentences that only mean something once the source
   * has a history: that routed conversations stay where they are, and that a
   * destination has since been archived.
   */
  mode: "create" | "edit";
  /**
   * Whether the destination in `value` has been archived or deleted, as
   * reported by the server. Deliberately not inferred from the destination
   * failing to resolve against `availableProjects`: that also happens for a
   * project outside the reader's own teams, and naming an access boundary as
   * a deletion would send an admin to restore a project that was never gone.
   *
   * It describes `value`, not the row the drawer opened on. The server
   * reports archival of the *stored* destination, so a caller holding both
   * must stop passing it true once the admin picks a replacement — otherwise
   * the picker seeds empty over the admin's own selection and the archived
   * notice contradicts what they just chose
   * (`inventory.tsx`, `destinationUntouched`).
   */
  destinationArchived?: boolean;
  organizationId: string;
  organizationName?: string;
  availableTeams: Array<{ id: string; name: string }>;
  availableProjects: Array<{ id: string; name: string; teamId?: string }>;
};

/**
 * The picker, in the one configuration a destination is ever set in:
 * `ScopeChipPicker` single-select over PROJECT scopes.
 *
 * Rendered in the archived case too, and that is the point: telling an admin
 * routing has stopped while offering no control to restart it strands them.
 * It seeds empty there because the archived id is not a project the picker
 * can name or the server would accept back.
 */
function DestinationPicker({
  value,
  destinationArchived,
  onChange,
  organizationId,
  organizationName,
  availableTeams,
  availableProjects,
}: Pick<
  TraceDestinationFieldProps,
  | "value"
  | "onChange"
  | "organizationId"
  | "organizationName"
  | "availableTeams"
  | "availableProjects"
> & { destinationArchived: boolean }) {
  return (
    <ScopeChipPicker
      value={
        value && !destinationArchived
          ? [{ scopeType: "PROJECT" as const, scopeId: value }]
          : []
      }
      onChange={(next) => onChange(next[0]?.scopeId ?? null)}
      organizationId={organizationId}
      organizationName={organizationName}
      availableTeams={availableTeams}
      availableProjects={availableProjects}
      allowedScopeTypes={["PROJECT"]}
      variant="single-select"
      label=""
      placeholder="Select a project"
      showSummary={false}
    />
  );
}

export function TraceDestinationField({
  sourceType,
  value,
  onChange,
  mode,
  destinationArchived = false,
  organizationId,
  organizationName,
  availableTeams,
  availableProjects,
}: TraceDestinationFieldProps) {
  if (!routesConversations(sourceType)) return null;

  const picked = value !== null && !destinationArchived;

  return (
    <VStack
      align="start"
      width="full"
      gap={1.5}
      data-testid="ingestion-trace-destination"
    >
      <HStack gap={1} alignItems="center">
        <SmallLabel>Conversations land in</SmallLabel>
        <FieldInfoTooltip
          description="The project whose trace explorer this source's conversations become readable in. Leaving it unset means the source still records its audit events, but nothing reaches the explorer. A destination grants no access to the source itself."
          testId="ingestion-trace-destination-info"
        />
      </HStack>

      {destinationArchived && <ArchivedDestinationNotice />}

      <DestinationPicker
        value={value}
        destinationArchived={destinationArchived}
        onChange={onChange}
        organizationId={organizationId}
        organizationName={organizationName}
        availableTeams={availableTeams}
        availableProjects={availableProjects}
      />

      {value === null && !destinationArchived && (
        <Text
          fontSize="xs"
          color="fg.muted"
          data-testid="ingestion-trace-destination-empty"
        >
          This source&rsquo;s conversations will not be readable in the trace
          explorer until you pick one. Its audit events are recorded either way.
        </Text>
      )}

      {picked && <PickedDestinationConsequences mode={mode} />}
    </VStack>
  );
}
