/**
 * Capability-card dispatcher.
 */

import { VStack } from "@chakra-ui/react";
import {
  asJsonDocument,
  type CliToolResult,
  namesCreatedResource,
  parseCliToolResult,
  toCliToolResult,
} from "@langwatch/langy-contract";
import { useOrganizationTeamProject } from "../../../../../behavior/use-organization-team-project";
import { digestOfToolCall, LangyCardBoundary } from "../../../../../index";
import {
  type CapabilityCardInput,
  type CapabilityDescriptor,
  isProposalOutput,
  resolveCapability,
  withDecidedCard,
} from "../../../model/capabilities/capability-registry";
import { deriveFollowUpChips } from "../../../model/capabilities/follow-up-chips";
import { LangyDatasetCard } from "./langy-dataset-card";
import { LangyDeclarativeCard } from "./langy-declarative-card";
import { LangyEvalRunCard } from "./langy-eval-run-card";
import { LangyFollowUpChips } from "./langy-follow-up-chips";
import { LangyMetricsCard } from "./langy-metrics-card";
import { LangyScenarioCard } from "./langy-scenario-card";
import { LangyTimeseriesCard } from "./langy-timeseries-card";
import { LangyTraceSampleCard } from "./langy-trace-sample-card";
import { LangyTracesCard } from "./langy-traces-card";

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
 * A result that cannot substantiate the card it would draw.
 */
function claimsNothing(result: CliToolResult): boolean {
  if (result.kind !== "card") return false;
  if (result.outcome === "unconfirmed") return true;
  return result.card === "resourceCreated" && !namesCreatedResource(result.payload);
}

/**
 * The card a call draws, and the result behind it.
 */
export function capabilityRenderFor(call: CapabilityToolCall): {
  descriptor: CapabilityDescriptor;
  result: CliToolResult | null;
} | null {
  const nominal = resolveCapability(call.name);
  if (!nominal) return null;

  const result = toolResultForCapability(call, nominal);
  return {
    descriptor:
      result?.kind === "card"
        ? withDecidedCard({ descriptor: nominal, card: result.card })
        : nominal,
    result,
  };
}

/**
 * True when a call should render as a capability card: it has settled with a
 * successful output, its name maps to a descriptor, it isn't a staged proposal
 * (those belong to ProposalCard), and its result actually substantiates a card.
 */
export function hasCapabilityCard(call: CapabilityToolCall): boolean {
  if (call.state !== "output-available") return false;
  if (isProposalOutput(call.output)) return false;
  const resolved = capabilityRenderFor(call);
  if (!resolved) return false;
  const { descriptor, result } = resolved;

  // Any card the envelope decided draws — the payload was already validated
  // against that card's schema when it was stamped, so the remaining question
  // is only whether it substantiates the claim the card makes.
  if (result?.kind === "card") return !claimsNothing(result);

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

export function LangyCapabilityRenderer({ call }: { call: CapabilityToolCall }) {
  const { project } = useOrganizationTeamProject();
  const resolved = capabilityRenderFor(call);
  if (!resolved) return null;

  const projectSlug = project?.slug ?? null;
  const { descriptor, result } = resolved;
  if (result?.kind !== "card") return null;
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

  // Every capability card renders inside its own boundary: these cards eat
  // tenant- and command-shaped payloads, and one unreadable result must cost
  // one card, never the transcript around it.
  return (
    <LangyCardBoundary scope="this card">
      {chips.length === 0 ? (
        card
      ) : (
        <VStack align="stretch" gap={2}>
          {card}
          <LangyFollowUpChips chips={chips} />
        </VStack>
      )}
    </LangyCardBoundary>
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
    case "timeseries":
      return <LangyTimeseriesCard {...props} />;
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
