/**
 * Capability-card dispatcher.
 *
 * Given one settled tool call, decodes its result and mounts the card that
 * result was stamped with (`capabilityRenderFor`; the command's name only
 * seeds the descriptor's wording and surface). The project slug (for deep
 * links) is read once here from the org/team/project hook and threaded down,
 * so the individual cards stay pure of app context.
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
  namesCreatedResource,
  parseCliToolResult,
  toCliToolResult,
  type CliToolResult,
} from "@langwatch/cli-cards";
import { VStack } from "@chakra-ui/react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { digestOfToolCall } from "../../logic/langyCapabilityDigest";
import { LangyCardBoundary } from "../LangyCardBoundary";
import {
  isProposalOutput,
  resolveCapability,
  withDecidedCard,
  type CapabilityCardInput,
  type CapabilityDescriptor,
} from "./capabilityRegistry";
import { deriveFollowUpChips } from "./followUpChips";
import { LangyDatasetCard } from "./LangyDatasetCard";
import { LangyDeclarativeCard } from "./LangyDeclarativeCard";
import { LangyEvalRunCard } from "./LangyEvalRunCard";
import { LangyFollowUpChips } from "./LangyFollowUpChips";
import { LangyMetricsCard } from "./LangyMetricsCard";
import { LangyTimeseriesCard } from "./LangyTimeseriesCard";
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
 * A result that cannot substantiate the card it would draw.
 *
 * A create card is a CLAIM — "this exists now, here is the way to it" — and a
 * create whose result names nothing created cannot support it. The card used to
 * own that doubt out loud ("Couldn't confirm the scenario was created"), which
 * was better than the green receipt it replaced but is still a card about
 * nothing: it appeared beside the error card for the SAME operation, telling the
 * same failure a second time in weaker words, and it contradicted the first
 * card's framing. If we are not sure something happened, we do not draw a card
 * saying so — the prose and the failure card already carry it, and the call
 * still appears in the turn's completed-steps receipt.
 *
 * Two signals, because they arrive on different vintages of turn: `outcome` is
 * the verdict the CLI envelope records (`toCliToolResult`), and the payload
 * check catches turns stored before that field existed.
 */
function claimsNothing(result: CliToolResult): boolean {
  if (result.kind !== "card") return false;
  if (result.outcome === "unconfirmed") return true;
  return (
    result.card === "resourceCreated" && !namesCreatedResource(result.payload)
  );
}

/**
 * The card a call draws, and the result behind it.
 *
 * TWO steps, in this order, and the order is the whole point. The name gives a
 * descriptor — which is what lets an older turn's raw output be read back into
 * a result at all. The result then says which card it was stamped with at the
 * command boundary, and THAT card is the one drawn (`withDecidedCard`).
 *
 * What this replaced: both callers re-derived the card from the name and then
 * required the envelope's card to equal it. A promotion's defining property is
 * that the two differ, so every promotion failed the check and the call
 * dropped out of the capability stream entirely — the mechanism could only
 * ever remove a card, never improve one. See ADR-059 §1, and the spec rule
 * "The card a result was stamped with is the card that renders".
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

export function LangyCapabilityRenderer({
  call,
}: {
  call: CapabilityToolCall;
}) {
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
