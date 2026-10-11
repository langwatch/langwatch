import {
  Alert,
  Badge,
  Box,
  Button,
  Flex,
  Spinner,
  Text,
} from "@langwatch/design-system/primitives";

import { CodeFrame } from "../code/code-block.tsx";
import { CodeBody } from "../code/code-parts.tsx";
import type { CodeSource } from "../code/code-parts.tsx";
import type { Outcome } from "./playground-outcome.ts";
import { plainLines } from "./playground-source.ts";
function responseColour({ status }: { status: number }) {
  if (status < 300) return "green";
  if (status < 500) return "yellow";
  return "red";
}
export function ResponseArea({
  outcome,
  onRetry,
  curl,
}: {
  outcome: Outcome;
  onRetry: () => void;
  curl: string;
}) {
  if (outcome.kind === "idle") {
    return (
      <Text margin="0" fontSize="13px" color="fg.muted">
        Send a request to see the response.
      </Text>
    );
  }
  if (outcome.kind === "sending") {
    return (
      <Flex alignItems="center" gap="2" fontSize="13px" color="fg.muted">
        <Spinner size="sm" /> Waiting for a response...
      </Flex>
    );
  }
  if (outcome.kind === "error") {
    return (
      <Alert.Root status="warning" variant="outline">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Description>{outcome.message}</Alert.Description>
          <Flex gap="2" marginTop="2">
            <Button type="button" size="xs" variant="outline" colorPalette="gray" onClick={onRetry}>
              Retry
            </Button>
            <Button
              type="button"
              size="xs"
              variant="outline"
              colorPalette="gray"
              onClick={() => navigator.clipboard.writeText(curl)}
            >
              Copy curl
            </Button>
          </Flex>
        </Alert.Content>
      </Alert.Root>
    );
  }
  let pretty = outcome.body;
  try {
    pretty = JSON.stringify(JSON.parse(outcome.body), null, 2);
  } catch {
    pretty = outcome.body;
  }
  const source: CodeSource = {
    lang: "json",
    title: "Body",
    code: pretty,
    lines: plainLines({ code: pretty }),
    highlight: [],
    numbered: false,
  };
  return (
    <Box>
      <Flex gap="3" alignItems="center" fontSize="12px" wrap="wrap" marginBottom="2">
        <Badge size="sm" variant="subtle" colorPalette={responseColour({ status: outcome.status })}>
          {outcome.status} {outcome.statusText}
        </Badge>
        <Text as="span" color="fg.muted">
          {outcome.ms} ms · {outcome.contentType}
        </Text>
      </Flex>
      <CodeFrame>
        <CodeBody source={source} expanded={false} />
      </CodeFrame>
    </Box>
  );
}
