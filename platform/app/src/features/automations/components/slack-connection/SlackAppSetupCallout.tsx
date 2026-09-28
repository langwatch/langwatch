import {
  Box,
  Button,
  Code,
  HStack,
  Link,
  List,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useEffect, useRef, useState } from "react";
import { toaster } from "~/components/ui/toaster";
import { SLACK_APP_MANIFEST } from "~/features/automations/providers/slack/slackAppManifest";

/** Where a bot token comes from: create the Slack app from our manifest,
 *  install it, copy the token. Shown beside the bot token field. */
export function SlackAppSetupCallout() {
  const [stepsOpen, setStepsOpen] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const copyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copyResetTimer.current) clearTimeout(copyResetTimer.current);
    },
    [],
  );

  const copyFailed = () =>
    toaster.create({
      type: "error",
      title: "Couldn't copy the manifest",
      description: "Select the manifest text and copy it manually.",
    });

  const copyManifest = () => {
    // The Clipboard API is absent over plain HTTP, which self-hosted instances
    // run, so a missing API reads the same as a denied write.
    const clipboard = navigator.clipboard;
    if (!clipboard) {
      copyFailed();
      return;
    }
    clipboard
      .writeText(SLACK_APP_MANIFEST)
      .then(() => {
        setIsCopied(true);
        copyResetTimer.current = setTimeout(() => setIsCopied(false), 1500);
      })
      .catch(copyFailed);
  };

  return (
    <Box
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      bg="bg.subtle"
      padding={3}
    >
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
        {stepsOpen ? (
          <List.Root as="ol" gap={1} paddingLeft={4}>
            <List.Item>
              <Text fontSize="xs" color="fg.muted">
                Create the app with &ldquo;From a manifest,&rdquo; choose the
                YAML format, and paste the copied manifest. It sets the
                permissions for you.
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
                Public channels work straight away. To post to a private
                channel, add the app to that channel first.
              </Text>
            </List.Item>
          </List.Root>
        ) : null}
      </VStack>
    </Box>
  );
}
