import { Badge, Box, HStack, Text, VStack } from "@chakra-ui/react";
import { CollapsibleSection, CopyButton } from "../elements/http-test-components";

export function HttpTestRequestPreview({
  url,
  method,
  headers,
  body,
}: {
  url?: string;
  method?: string;
  headers?: Array<{ key: string; value: string }>;
  body: string;
}) {
  return (
    <CollapsibleSection title="Request Preview" defaultOpen>
      <VStack align="stretch" gap={2} fontSize="sm">
        <HStack>
          <Badge colorPalette="blue">{method ?? "POST"}</Badge>
          <Text fontFamily="mono" fontSize="xs" wordBreak="break-all">
            {url ?? "No URL configured"}
          </Text>
        </HStack>
        {headers && headers.length > 0 && (
          <Box>
            <Text fontWeight="medium" fontSize="xs" color="fg.muted">
              Headers:
            </Text>
            <Box
              as="pre"
              fontSize="xs"
              fontFamily="mono"
              bg="bg.subtle"
              padding={2}
              borderRadius="md"
              overflow="auto"
            >
              {headers.map((header) => `${header.key}: ${header.value}`).join("\n")}
            </Box>
          </Box>
        )}
        <Box>
          <HStack justify="space-between">
            <Text fontWeight="medium" fontSize="xs" color="fg.muted">
              Body (rendered):
            </Text>
            <CopyButton text={body} label="Copy body" />
          </HStack>
          <Box
            as="pre"
            fontSize="xs"
            fontFamily="mono"
            bg="bg.subtle"
            padding={2}
            borderRadius="md"
            overflow="auto"
            maxHeight="150px"
            whiteSpace="pre-wrap"
          >
            {body}
          </Box>
        </Box>
      </VStack>
    </CollapsibleSection>
  );
}
