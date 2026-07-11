/**
 * Capability-card dispatcher.
 *
 * Given one settled tool call, resolves its name to a `CapabilityDescriptor`
 * and mounts the matching bespoke card. The project slug (for deep links) is
 * read once here from the org/team/project hook and threaded down, so the
 * individual cards stay pure of app context.
 *
 * Beneath the card it also draws the follow-up suggestions the result justifies
 * — the quiet "Graph these" / "Alert me on this" chips. WHICH offers to make is
 * `cliFollowUps.ts`'s call, driven by the feature map; WHERE each lands is a
 * `traceQueryIntent` builder that recompiles the search into a destination URL.
 * An offer only becomes a chip when a builder can actually carry it out, so
 * offers with no destination (dataset / annotation / lens — no link exists yet)
 * are silently dropped rather than rendered as dead ends.
 *
 * `hasCapabilityCard` is the shared predicate that decides whether a call
 * renders as a card at all — used both here and by LangyToolActivity to skip
 * such calls in the generic activity collapser (so a settled search never shows
 * both a "Analysing traces" line AND a traces card).
 */
import { VStack } from "@chakra-ui/react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import {
  isProposalOutput,
  resolveCapability,
  type CapabilityDescriptor,
} from "./capabilityRegistry";
import { deriveFollowUpChips } from "./followUpChips";
import { LangyDatasetCard } from "./LangyDatasetCard";
import { LangyEvalRunCard } from "./LangyEvalRunCard";
import { LangyFollowUpChips } from "./LangyFollowUpChips";
import { LangyMetricsCard } from "./LangyMetricsCard";
import { LangyResourceResultCard } from "./LangyResourceResultCard";
import { LangyScenarioCard } from "./LangyScenarioCard";
import { LangyTraceSampleCard } from "./LangyTraceSampleCard";
import { LangyTracesCard } from "./LangyTracesCard";

/** The slice of a tool call a capability card needs. */
export interface CapabilityToolCall {
  name: string;
  state: string;
  input: unknown;
  output: unknown;
}

/**
 * True when a call should render as a capability card: it has settled with a
 * successful output, its name maps to a descriptor, and it isn't a staged
 * proposal (those belong to ProposalCard).
 */
export function hasCapabilityCard(call: CapabilityToolCall): boolean {
  if (call.state !== "output-available") return false;
  if (isProposalOutput(call.output)) return false;
  return resolveCapability(call.name) !== null;
}

export function LangyCapabilityRenderer({
  call,
}: {
  call: CapabilityToolCall;
}) {
  const { project } = useOrganizationTeamProject();
  const descriptor = resolveCapability(call.name);
  if (!descriptor) return null;

  const projectSlug = project?.slug ?? null;
  const card = (
    <CapabilityCard
      descriptor={descriptor}
      input={call.input}
      output={call.output}
      projectSlug={projectSlug}
    />
  );

  const chips = deriveFollowUpChips({ call, projectSlug });
  if (chips.length === 0) return card;

  return (
    <VStack align="stretch" gap={2}>
      {card}
      <LangyFollowUpChips chips={chips} />
    </VStack>
  );
}

function CapabilityCard({
  descriptor,
  input,
  output,
  projectSlug,
}: {
  descriptor: CapabilityDescriptor;
  input: unknown;
  output: unknown;
  projectSlug: string | null;
}) {
  const props = { descriptor, input, output, projectSlug };
  switch (descriptor.render) {
    // `traces` is a trace SEARCH — the sample card, matched traces plus a way
    // through to the Trace Explorer. `trace` is a single `get`.
    case "traces":
      return <LangyTraceSampleCard {...props} />;
    case "trace":
      return <LangyTracesCard {...props} />;
    case "metrics":
      return <LangyMetricsCard {...props} />;
    case "evalRun":
      return <LangyEvalRunCard {...props} />;
    case "dataset":
      return <LangyDatasetCard {...props} />;
    case "scenario":
      return <LangyScenarioCard {...props} />;
    case "promptDiff":
    case "resourceCreated":
    case "resourceUpdated":
    case "resourceRemoved":
    case "resourceRead":
      return <LangyResourceResultCard {...props} />;
    default:
      return null;
  }
}
