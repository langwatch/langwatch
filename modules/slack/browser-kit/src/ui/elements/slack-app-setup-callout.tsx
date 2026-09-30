import { Box, Button, Code, HStack, Link, List, Text, VStack } from "@chakra-ui/react";
import { useState } from "react";

import { useCopySlackAppManifest } from "../../behavior/use-copy-slack-app-manifest.ts";

/** Where a bot token comes from: create the Slack app from our manifest, install it, copy
 *  the token. Shown beside the bot token field. */
export function SlackAppSetupCallout() {
  const [stepsOpen, setStepsOpen] = useState(false);
  const { isCopied, copyManifest } = useCopySlackAppManifest();

  return (
    <Box borderWidth="1px" borderColor="border.muted" borderRadius="md" bg="bg.subtle" padding={3}>
      <VStack align="stretch" gap={2}>
        <HStack gap={3} wrap="wrap">
          <Link
            href="https://api.slack.com/apps"
            target="_blank"
            rel="noopener noreferrer"
            fontSize="xs"
            fontWeight="medium"
          >
            Create a Slack app
          </Link>
          <Button
            variant="plain"
            size="xs"
            height="auto"
            paddingX={0}
            color="fg.muted"
            _hover={{ color: "fg" }}
            onClick={copyManifest}
          >
            {isCopied ? "Manifest copied" : "Copy app manifest"}
          </Button>
          <Button
            variant="plain"
            size="xs"
            height="auto"
            paddingX={0}
            color="fg.muted"
            _hover={{ color: "fg" }}
            onClick={() => setStepsOpen((previous) => !previous)}
          >
            {stepsOpen ? "Hide the steps" : "Where do I get a bot token?"}
          </Button>
        </HStack>
        {stepsOpen ? <SlackAppSetupSteps /> : null}
      </VStack>
    </Box>
  );
}

/** The three steps from a created app to a working bot token. */
function SlackAppSetupSteps() {
  return (
    <List.Root as="ol" gap={1} paddingLeft={4}>
      <List.Item>
        <Text fontSize="xs" color="fg.muted">
          Create the app with &ldquo;From a manifest,&rdquo; choose the YAML format, and paste the
          copied manifest. It sets the permissions for you.
        </Text>
      </List.Item>
      <List.Item>
        <Text fontSize="xs" color="fg.muted">
          Install it to your workspace and copy the Bot User OAuth Token (
          <Code size="sm">xoxb-</Code>).
        </Text>
      </List.Item>
      <List.Item>
        <Text fontSize="xs" color="fg.muted">
          Public channels work straight away. To post to a private channel, add the app to that
          channel first.
        </Text>
      </List.Item>
    </List.Root>
  );
}
