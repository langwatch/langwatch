/**
 * Capability-card dispatcher.
 *
 * Given one settled tool call, resolves its name to a `CapabilityDescriptor`
 * and mounts the matching bespoke card. The project slug (for deep links) is
 * read once here from the org/team/project hook and threaded down, so the
 * individual cards stay pure of app context.
 *
 * `hasCapabilityCard` is the shared predicate that decides whether a call
 * renders as a card at all — used both here and by LangyToolActivity to skip
 * such calls in the generic activity collapser (so a settled search never shows
 * both a "Analysing traces" line AND a traces card).
 */
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import {
  isProposalOutput,
  resolveCapability,
  type CapabilityDescriptor,
} from "./capabilityRegistry";
import { LangyDatasetCard } from "./LangyDatasetCard";
import { LangyEvalRunCard } from "./LangyEvalRunCard";
import { LangyMetricsCard } from "./LangyMetricsCard";
import { LangyResourceResultCard } from "./LangyResourceResultCard";
import { LangyScenarioCard } from "./LangyScenarioCard";
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

export function LangyCapabilityRenderer({ call }: { call: CapabilityToolCall }) {
  const { project } = useOrganizationTeamProject();
  const descriptor = resolveCapability(call.name);
  if (!descriptor) return null;
  return (
    <CapabilityCard
      descriptor={descriptor}
      input={call.input}
      output={call.output}
      projectSlug={project?.slug ?? null}
    />
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
    case "traces":
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
