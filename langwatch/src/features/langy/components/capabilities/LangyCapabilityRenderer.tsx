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
import {
  asJsonDocument,
  parseCliToolResult,
  toCliToolResult,
  type CliToolResult,
} from "@langwatch/cli-cards";
import { VStack } from "@chakra-ui/react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { digestOfToolCall } from "../../logic/langyCapabilityDigest";
import {
  isProposalOutput,
  resolveCapability,
  type CapabilityCardInput,
  type CapabilityDescriptor,
} from "./capabilityRegistry";
import { deriveFollowUpChips } from "./followUpChips";
import { LangyDatasetCard } from "./LangyDatasetCard";
import { LangyDeclarativeCard } from "./LangyDeclarativeCard";
import { LangyEvalRunCard } from "./LangyEvalRunCard";
import { LangyFollowUpChips } from "./LangyFollowUpChips";
import { LangyMetricsCard } from "./LangyMetricsCard";
import { LangyScenarioCard } from "./LangyScenarioCard";
import { LangyTraceSampleCard } from "./LangyTraceSampleCard";
import { LangyTracesCard } from "./LangyTracesCard";

/** The slice of a tool call a capability card needs. */
export interface CapabilityToolCall {
  name: string;
  state: string;
  input: unknown;
  output: unknown;
  /**
   * The recorded result digest, when the durable part carries one. Live frames
   * and old turns arrive without it; the renderer recomputes via the shared
   * extractor, so both paths hydrate identically.
   */
  digest?: unknown;
  /** Validated card result on durable parts; live AI-SDK chunks carry it in output. */
  result?: unknown;
}

/**
 * Decode the canonical union, with a read-only legacy adapter for turns stored
 * before the union existed. This is the sole compatibility seam: no card is
 * allowed to duck-type raw output itself.
 */
export function toolResultForCapability(
  call: CapabilityToolCall,
  descriptor = resolveCapability(call.name),
): CliToolResult | null {
  const canonical = parseCliToolResult(call.result ?? call.output);
  if (canonical) return canonical;
  if (!descriptor) return null;
  const payload = asJsonDocument(call.output);
  if (payload === null) return null;
  return toCliToolResult({
    resource: descriptor.command.resource,
    verb: descriptor.command.verb,
    payload,
  });
}

/**
 * True when a call should render as a capability card: it has settled with a
 * successful output, its name maps to a descriptor, and it isn't a staged
 * proposal (those belong to ProposalCard).
 */
export function hasCapabilityCard(call: CapabilityToolCall): boolean {
  if (call.state !== "output-available") return false;
  if (isProposalOutput(call.output)) return false;
  const descriptor = resolveCapability(call.name);
  if (!descriptor) return false;

  const result = toolResultForCapability(call, descriptor);
  // This identity check is the important boundary: a trace-search may only
  // render the traces variant, never a structurally plausible result produced
  // by another command or a stale `{ value: ... }` transport payload.
  if (result?.card === descriptor.render) return true;

  // Older/live dataset list calls carried the collection directly as
  // `{datasets: [...]}` rather than the newer typed result envelope. Keep
  // those calls in the capability stream so they can still render a dataset
  // receipt and, importantly, do not get mistaken for generic activity when
  // trace-card selection collapses neighbouring searches.
  if (descriptor.render === "dataset") {
    const legacy = asJsonDocument(call.output);
    return !!legacy && typeof legacy === "object";
  }

  return false;
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
  const result = toolResultForCapability(call, descriptor);
  if (!result) return null;
  // The reference the card hydrates fresh data from — the recorded digest when
  // the part carries one (validated), recomputed from the call otherwise.
  const digest = digestOfToolCall({
    name: call.name,
    input: call.input,
    output: call.output,
    digest: call.digest,
  });
  const card = (
    <CapabilityCard
      descriptor={descriptor}
      input={call.input}
      output={result.payload}
      digest={digest}
      projectSlug={projectSlug}
    />
  );

  const chips = deriveFollowUpChips({
    call: { ...call, output: result.payload },
    projectSlug,
  });
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
  digest,
  projectSlug,
}: {
  descriptor: CapabilityDescriptor;
  input: unknown;
  output: unknown;
  digest: CapabilityCardInput["digest"];
  projectSlug: string | null;
}) {
  const props = { descriptor, input, output, digest, projectSlug };
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
    // A kind this switch has never heard of (version skew: the shared contract
    // grew a card before this component did) still renders the declarative
    // card — a plainer card always beats no card.
    default:
      return <LangyDeclarativeCard {...props} />;
  }
}
