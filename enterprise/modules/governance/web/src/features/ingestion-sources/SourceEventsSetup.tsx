// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { Box, Code, IconButton, Text, VStack } from "@chakra-ui/react";
import type { SourceType } from "@ee/governance/services/activity-monitor/ingestionSource.service";
import { Inbox, Info } from "lucide-react";
import { GovernanceEmptyState } from "~/components/governance/empty";
import { Link } from "~/components/ui/link";
import { Popover } from "~/components/ui/popover";

import { needsIngestSecret } from "./ingestionSourceCatalog";

/**
 * The two things the Events section shows when it is not showing rows: the
 * setup instructions, and the pane that says nothing has arrived.
 *
 * They live beside `SourceEventsTable` rather than on the detail page because
 * they are that section's furniture, and because the page they came from is
 * long enough that a hundred lines of copy at the bottom of it was where the
 * copy went to be forgotten.
 *
 * Spec: specs/ai-gateway/governance/ingestion-sources.feature
 *       (rule "The events table pages through everything the source ever
 *       ingested" — scenario "An idle source explains itself in a pane, not
 *       in a wall of setup text")
 */

/**
 * Structural, so this pair takes a plain fixture in tests and never imports
 * tRPC — the same reason `SourceEventRowData` exists next door.
 */
export type SourceEventsSetupSource = {
  id: string;
  sourceType: string;
};

/**
 * The two push routes that exist, and exactly which source types each one
 * accepts — mirrored from the handlers' own guards, which are the contract:
 * `ingestionRoutes.ts:411-413` and `:541-543`. A type absent from both is
 * pushed to by nothing and has no endpoint to show.
 *
 * NOT `modeForSourceType`. The catalog's `mode` is how a source is configured,
 * which is a different axis from which route accepts it: `s3_custom` is mode
 * `"s3"` and the webhook handler takes it anyway, in callback mode. Reading
 * the catalog here would have silently dropped a real endpoint.
 *
 * `otel_generic` appears in both guards; `otel` is the one its own setup flow
 * names, so it wins here.
 *
 * Typed as `SourceType[]` on purpose. A list of bare strings is what went
 * stale in the first place, and a bare-string list cannot notice a renamed
 * union member — it just stops matching, at runtime, in the same silent way.
 * Annotated, a rename stops the build here instead.
 */
const OTEL_PUSH_TYPES: SourceType[] = [
  "otel_generic",
  "claude_cowork",
  "claude_code",
];
const WEBHOOK_PUSH_TYPES: SourceType[] = ["workato", "s3_custom"];

/**
 * Which push route this source listens on, or `null` when it listens on none.
 *
 * The list this replaced was kept here by hand and had already gone stale: it
 * was missing `claude_code`, a push source that was therefore being handed a
 * URL with a literal `<mode>` segment in it — a 404 shown to a reader the
 * surrounding copy tells to paste it.
 */
function pushRouteFor(
  source: SourceEventsSetupSource,
): "otel" | "webhook" | null {
  // The fixture is structural by design (see above), so the union is reached
  // by cast. An unrecognised string simply matches neither list.
  const sourceType = source.sourceType as SourceType;
  if (OTEL_PUSH_TYPES.includes(sourceType)) return "otel";
  if (WEBHOOK_PUSH_TYPES.includes(sourceType)) return "webhook";
  return null;
}

/**
 * The bearer endpoint this source listens on, as a reader would paste it, or
 * `null` for a source that listens on nothing.
 *
 * Derived from the browser's own origin rather than a configured base URL,
 * because a self-hosted install and the SaaS see different hosts, and the one
 * the reader is looking at is the one their client has to reach.
 *
 * NULL RATHER THAN A PLACEHOLDER. This used to fall back to a literal
 * `<mode>` segment, which rendered a URL that 404s to every pull and S3
 * source on the product — and the doc line above promises a reader can paste
 * it. A caller that has no endpoint to show has to say something else; there
 * is no string that is honest here.
 */
export function ingestEndpointFor(
  source: SourceEventsSetupSource,
): string | null {
  const route = pushRouteFor(source);
  if (!route) return null;
  const baseUrl =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://langwatch.invalid";
  return `${baseUrl}/api/ingest/${route}/${source.id}`;
}

/**
 * How to get events flowing into this source, behind an (i) beside the Events
 * heading.
 *
 * IT USED TO BE THE EMPTY STATE ITSELF — four paragraphs, a code block and two
 * links, dumped into the page body whenever the table came back empty. That
 * fails both readers. Someone who has already wired the source up never sees
 * any of it again, even though "which endpoint was this?" and "what happens
 * when I rotate the secret?" are questions a WORKING source raises just as
 * often; and someone who has not wired it up gets a wall of setup text where
 * the page should first be telling them, in a sentence, what state they are
 * in. Split, each reader gets the right thing: the pane says what is true, the
 * (i) says what to do about it, and the (i) is present in both states.
 *
 * A POPOVER, NOT A HOVER TOOLTIP, which is the whole reason this is not
 * `FieldInfoTooltip` at its default. The content carries two links, and a link
 * inside a hover-only tooltip is unreachable by keyboard and by touch — the
 * pointer has to leave the trigger to get to it. A click-toggled popover on a
 * real `IconButton` is focusable, activatable with Enter, and stays open while
 * the pointer travels into it. `FieldInfoTooltip` is the same shape and would
 * have been the component outright, except its body is one string plus one doc
 * link; this needs an endpoint, a sample body and two links.
 */
export function EventsSetupPopover({
  source,
}: {
  source: SourceEventsSetupSource;
}) {
  const route = pushRouteFor(source);
  const endpoint = ingestEndpointFor(source);
  const showsSecret = needsIngestSecret({
    sourceType: source.sourceType as SourceType,
  });
  return (
    <Popover.Root positioning={{ placement: "bottom-start" }}>
      <Popover.Trigger asChild>
        <IconButton
          aria-label="How to send events to this source"
          data-testid="events-setup-info"
          size="xs"
          variant="ghost"
          color="fg.muted"
          minWidth="auto"
          height="auto"
          padding={0}
        >
          <Info size={14} />
        </IconButton>
      </Popover.Trigger>
      <Popover.Content maxWidth="lg">
        <Popover.Arrow>
          <Popover.ArrowTip />
        </Popover.Arrow>
        <Popover.Body>
          <VStack align="stretch" gap={3}>
            {endpoint ? (
              <Text fontSize="sm" color="fg.muted">
                Push an OTLP body to{" "}
                {/* break-all, because this is one long unbreakable token: the
                    only natural break in it is the hyphen in a subdomain, and
                    what follows that hyphen is wider than the popover. Without
                    it the URL paints outside the card. The sample body below
                    solved the same problem with overflowX; inline text cannot,
                    because it has no box of its own to scroll. */}
                <Code fontSize="xs" wordBreak="break-all">
                  {endpoint}
                </Code>{" "}
                with this source&apos;s bearer secret to start populating.
              </Text>
            ) : (
              <Text fontSize="sm" color="fg.muted">
                This source is pulled, not pushed to. LangWatch fetches from the
                provider on the source&apos;s schedule, and events appear here
                after the first successful pull.
              </Text>
            )}
            {/* Push-only: it is advice about where to send spans, and a source
                that receives none has nowhere to send them. */}
            {route && (
              <Text fontSize="xs" color="fg.muted">
                Spans land in the LangWatch trace store with this source&apos;s
                origin tag, viewable in the trace viewer. If you are sending
                agent traces from your own LangWatch SDK, use{" "}
                <Code fontSize="xs">/api/otel/v1/traces</Code> with your project
                API key - different auth, same trace store. See{" "}
                <Link
                  href="https://docs.langwatch.ai/observability/trace-vs-activity-ingestion"
                  color="blue.600"
                  isExternal
                >
                  Choosing the right OTel endpoint
                </Link>
                .
              </Text>
            )}
            {/* Lost the secret? What survived of the old paragraph is what a
                rotation DOES. What did not survive is the half telling a
                reader to click a named button: prose naming a control goes
                stale the moment the control is renamed, and no rule about
                controls can catch a sentence. The control itself is in the
                page header, where this page's controls live.

                Gated on the catalog's own `needsIngestSecret` rather than on
                the push route, because the two lists are not the same list and
                this paragraph follows the secret: an API-pull source holds
                provider credentials, which is not the bearer described here.
                Asking the catalog keeps that answer in one place. */}
            {showsSecret && (
              <Text fontSize="xs" color="fg.muted">
                Rotating this source&apos;s secret shows the new bearer once,
                with a copy-paste curl example. The previous secret stays valid
                for 24h while you roll the new value through every upstream
                client.
              </Text>
            )}
            {route === "otel" && (
              <Box
                borderWidth="1px"
                borderColor="border.muted"
                borderRadius="md"
                padding={3}
              >
                <Text
                  fontSize="xs"
                  fontWeight="semibold"
                  color="fg.muted"
                  mb={2}
                >
                  Minimum viable OTLP body shape (camelCase keys):
                </Text>
                <Code
                  display="block"
                  fontSize="xs"
                  whiteSpace="pre"
                  overflowX="auto"
                  padding={2}
                >{`{
  "resource_spans": [{
    "scope_spans": [{
      "spans": [{
        "name": "chat.completion",
        "startTimeUnixNano": "<NOW_NS>",
        "attributes": [
          { "key": "gen_ai.request.model",       "value": { "stringValue": "claude-sonnet-4" } },
          { "key": "gen_ai.usage.input_tokens",  "value": { "intValue": 120 } },
          { "key": "gen_ai.usage.output_tokens", "value": { "intValue": 480 } },
          { "key": "gen_ai.usage.cost_usd",      "value": { "doubleValue": 0.025 } },
          { "key": "user.email",                 "value": { "stringValue": "you@your.org" } }
        ]
      }]
    }]
  }]
}`}</Code>
                <Text fontSize="xs" color="fg.muted" mt={2}>
                  Returns HTTP 202 with <Code fontSize="xs">events: 1</Code> on
                  success. If you get <Code fontSize="xs">events: 0</Code> with
                  a hint, the body shape didn&apos;t parse. See the{" "}
                  <Link
                    href="https://docs.langwatch.ai/ai-gateway/governance/ingestion-sources/otel-generic"
                    color="blue.600"
                    isExternal
                  >
                    otel-generic docs
                  </Link>{" "}
                  for the full attribute reference.
                </Text>
              </Box>
            )}
          </VStack>
        </Popover.Body>
      </Popover.Content>
    </Popover.Root>
  );
}

/**
 * Nothing has arrived on this source yet.
 *
 * NO ACTION, deliberately, and this is the case the shared component's rule
 * names: a pane whose reader cannot create passes nothing and says so
 * (~/components/governance/empty). Events are not made from this screen — they
 * are sent to it by something upstream — so there is no create flow in the
 * header for this pane to repeat.
 *
 * The sentence names no control, for the same reason the setup popover no
 * longer does, and it claims nothing about WHY the source is idle: an endpoint
 * with nothing arriving on it is the only thing this pane actually knows.
 */
export function EmptyEventsState() {
  return (
    <GovernanceEmptyState
      testId="source-events-empty"
      icon={Inbox}
      headline="No events from this source yet"
      description="Nothing has arrived on this source's endpoint. Once an upstream client starts sending, its events appear here newest first."
    />
  );
}
