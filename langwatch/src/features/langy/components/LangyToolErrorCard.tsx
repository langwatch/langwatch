import {
  parseCliJson,
  readCliErrorDocument,
  type CliDomainError,
} from "@langwatch/cli-cards";
import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { AlertCircle, ExternalLink, ScrollText } from "lucide-react";
import { LangyCard } from "~/features/asaplangy";

export interface LangyToolErrorPresentation {
  title: string;
  message: string;
  traceId?: string;
  traceUrl?: string;
  logsUrl?: string;
}

type RecordValue = Record<string, unknown>;

function asRecord(value: unknown): RecordValue | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : null;
}

function safeHttpUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function readStructuredError(errorText: unknown): CliDomainError | null {
  if (typeof errorText === "string") {
    // Shell tools merge stderr with stdout. parseCliJson extracts the first
    // balanced JSON document, so a CLI error remains readable even when a
    // one-line human error was printed beside it.
    return readCliErrorDocument(parseCliJson(errorText));
  }
  return readCliErrorDocument(errorText);
}

function readableCliFailure(errorText: unknown): string | undefined {
  const value = asRecord(errorText);
  const text =
    typeof errorText === "string"
      ? errorText
      : typeof value?.text === "string"
        ? value.text
        : undefined;
  if (!text) return undefined;
  const line = text
    .split("\n")
    .map((part) => part.replace(/\u001b\[[0-9;]*m/g, "").trim())
    .find((part) => /failed to|request failed|self_signed_cert_in_chain/i.test(part));
  return line?.replace(/^✖\s*/, "").trim();
}

/**
 * Turn a failed tool part into safe, structured card copy.
 *
 * Only the CLI's typed error document is allowed to contribute a message. An
 * arbitrary shell stderr string can contain commands, file paths, credentials,
 * SQL, or ORM internals, so it stays behind developer mode in the raw payload.
 */
export function presentLangyToolError({
  title,
  errorText,
}: {
  title: string;
  errorText: unknown;
}): LangyToolErrorPresentation {
  const domain = readStructuredError(errorText);
  if (!domain) {
    return {
      title: `${title} failed`,
      message: readableCliFailure(errorText) ?? "This step couldn't be completed.",
    };
  }

  // New-CLI documents carry the trace links top-level on the error; documents
  // written by an older CLI keep them nested under `meta.trace` (the shared
  // REST handler's wire shape). Prefer the top-level fields, fall back to the
  // nested block so old documents keep their trace/logs actions.
  const trace = asRecord(domain.meta.trace);
  const traceId =
    domain.traceId ??
    (typeof trace?.traceId === "string" ? trace.traceId : undefined);
  const traceUrl = safeHttpUrl(domain.traceUrl) ?? safeHttpUrl(trace?.traceUrl);
  const logsUrl = safeHttpUrl(domain.logsUrl) ?? safeHttpUrl(trace?.logsUrl);

  return {
    title: `${title} failed`,
    message: domain.message,
    ...(traceId ? { traceId } : {}),
    ...(traceUrl ? { traceUrl } : {}),
    ...(logsUrl ? { logsUrl } : {}),
  };
}

/**
 * A failed Langy tool call, separate from both assistant prose and raw JSON.
 *
 * A calm `change`-weight receipt in Langy's own skin (asaplangy CARD_TAXONOMY),
 * not a red-washed alert box: the rust tone lives on the icon and title so the
 * card names what didn't complete without shouting, the message says it plainly,
 * and the ways to dig in (trace / logs) are offered as clear actions. The
 * reference stays for support.
 */
export function LangyToolErrorCard({
  presentation,
}: {
  presentation: LangyToolErrorPresentation;
}) {
  const hasActions = presentation.traceUrl || presentation.logsUrl;

  return (
    <LangyCard
      intent="change"
      role="alert"
      title={
        <HStack align="start" gap={2}>
          <Box color="red.fg" display="flex" flexShrink={0} marginTop="1px">
            <AlertCircle size={15} aria-hidden="true" />
          </Box>
          <VStack align="stretch" gap={0.5} minWidth={0} flex={1}>
            <Text textStyle="sm" fontWeight="640" color="fg" lineHeight="1.3">
              {presentation.title}
            </Text>
            <Text textStyle="xs" color="fg.muted" lineHeight="1.45">
              {presentation.message}
            </Text>
          </VStack>
        </HStack>
      }
      actions={
        hasActions ? (
          <HStack gap={1.5} flexWrap="wrap">
            {presentation.traceUrl ? (
              <Button size="xs" variant="outline" asChild>
                <a
                  href={presentation.traceUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Open debug trace in Grafana"
                >
                  <ExternalLink size={12} aria-hidden="true" />
                  Open trace
                </a>
              </Button>
            ) : null}
            {presentation.logsUrl ? (
              <Button size="xs" variant="outline" asChild>
                <a
                  href={presentation.logsUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Open related logs in Grafana"
                >
                  <ScrollText size={12} aria-hidden="true" />
                  Open logs
                </a>
              </Button>
            ) : null}
          </HStack>
        ) : null
      }
    >
      {presentation.traceId ? (
        <Text textStyle="2xs" color="fg.subtle" fontFamily="mono" truncate>
          Reference: {presentation.traceId}
        </Text>
      ) : null}
    </LangyCard>
  );
}
