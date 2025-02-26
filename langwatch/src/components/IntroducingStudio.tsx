import {
  Box,
  Button,
  Heading,
  HStack,
  VStack,
  Text,
  Spacer,
  useDisclosure,
} from "@chakra-ui/react";
import { Dialog } from "../components/ui/dialog";
import { Link } from "../components/ui/link";
import { useEffect } from "react";
import { trackEvent } from "../utils/tracking";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";

export const IntroducingStudio = () => {
  const { open, onOpen, onClose } = useDisclosure();
  const { project } = useOrganizationTeamProject();

  useEffect(() => {
    // Create a new script element
    const script = document.createElement("script");
    script.src =
      "https://static.hsappstatic.net/MeetingsEmbed/ex/MeetingsEmbedCode.js";
    script.type = "text/javascript";
    script.async = true;

    // Append the script to the body or a specific element
    document.body.appendChild(script);

    // Clean up the script when the component is unmounted
    return () => {
      document.body.removeChild(script);
    };
  }, []);
  return (
    <>
      <Dialog.Root open={open} onOpenChange={onClose} size="lg">
        <Dialog.Backdrop />
        <Dialog.Content>
          <Dialog.Header>
            <Dialog.Title>Book a Meeting</Dialog.Title>
            <Dialog.CloseTrigger />
          </Dialog.Header>
          <Dialog.Body>
            <Box width="full" height="690px">
              <iframe
                src="https://get.langwatch.ai/meetings/manouk-draisma/c-level?embed=true"
                frameBorder="0"
                width="100%"
                height="690px"
                allowFullScreen
              ></iframe>
            </Box>
          </Dialog.Body>
        </Dialog.Content>
      </Dialog.Root>
      <Box
        padding={6}
        borderRadius="lg"
        background="green.50"
        border="1px solid"
        borderColor="green.300"
      >
        <HStack align="stretch" height="full" gap={8}>
          <iframe
            width="500"
            height="280"
            src="https://www.youtube.com/embed/dZG44oRTz84"
            style={{
              borderRadius: "10px",
              border: "1px solid #CCC",
              minWidth: "500px",
            }}
          ></iframe>

          <VStack align="start" minHeight="full" gap={4}>
            <Heading as="h2" size="md">
              NEW! Introducing LangWatch Optimization Studio
            </Heading>
            <Text>
              We are excited to launch LangWatch Optimization Studio, a new tool
              for you to measure, evaluate and optimize your LLM pipelines with
              DSPy.
            </Text>
            <Text>
              🚀 <b>Get started</b> right away by creating your first workflow
              below
            </Text>
            <Text>
              <Link
                href="https://docs.langwatch.ai/optimization-studio/llm-nodes"
                isExternal
              >
                📺{" "}
                <b>
                  <u>Learn more</u>
                </b>
              </Link>{" "}
              with our video tutorial series
            </Text>
            <Text>
              <Button
                onClick={() => {
                  trackEvent("book_demo_click", {
                    project_id: project?.id,
                  });
                  onOpen();
                }}
                variant="plain"
                color="black"
                unstyled
              >
                <Text>
                  📅{" "}
                  <b>
                    <u>Book a demo</u>
                  </b>
                </Text>
              </Button>{" "}
              with one of our experts
            </Text>
            <Spacer />
            <HStack gap={4}>
              <Link href="/settings/subscription" asChild>
                <Button
                  colorPalette="green"
                  onClick={() => {
                    trackEvent("subscription_hook_click", {
                      project_id: project?.id,
                      hook: "studio_get_demo_access",
                    });
                  }}
                >
                  Subscribe
                </Button>
              </Link>
              <Text>for full access</Text>
            </HStack>
          </VStack>
        </HStack>
      </Box>
    </>
  );
};
