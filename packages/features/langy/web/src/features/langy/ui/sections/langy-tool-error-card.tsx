import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { AlertCircle, BookOpen, ExternalLink, ScrollText } from "lucide-react";
import { LangyCard } from "../../../asaplangy";
import type { LangyToolErrorPresentation } from "../../model/logic/langy-tool-failure";
import { LangyFailureReference } from "../../../../index";

/**
 * A failed Langy tool call, separate from both assistant prose and raw JSON.
 */
export function LangyToolErrorCard({ presentation }: { presentation: LangyToolErrorPresentation }) {
  const hasActions = presentation.traceUrl || presentation.logsUrl || presentation.docsUrl;
  const hasBody =
    !!presentation.detail ||
    !!presentation.tips?.length ||
    !!presentation.code ||
    !!presentation.raw ||
    !!presentation.traceId;

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
            {presentation.docsUrl ? (
              <Button size="xs" variant="outline" asChild>
                <a
                  href={presentation.docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Read the documentation for this problem"
                >
                  <BookOpen size={12} aria-hidden="true" />
                  Read the docs
                </a>
              </Button>
            ) : null}
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
      {hasBody ? (
        <VStack align="stretch" gap={1.5}>
          {presentation.detail ? (
            <Text textStyle="xs" color="fg" lineHeight="1.45">
              {presentation.detail}
            </Text>
          ) : null}
          {presentation.tips?.length ? (
            <VStack as="ul" align="stretch" gap={0.5} paddingLeft={4} margin={0}>
              {presentation.tips.map((tip) => (
                <Text as="li" key={tip} textStyle="xs" color="fg.muted" lineHeight="1.45">
                  {tip}
                </Text>
              ))}
            </VStack>
          ) : null}
          {presentation.code ? (
            <LangyFailureReference code={presentation.code} raw={presentation.raw} />
          ) : null}
          {presentation.traceId ? (
            <Text textStyle="2xs" color="fg.subtle" fontFamily="mono" truncate>
              Reference: {presentation.traceId}
            </Text>
          ) : null}
        </VStack>
      ) : null}
    </LangyCard>
  );
}
