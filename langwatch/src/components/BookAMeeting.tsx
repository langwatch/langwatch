import { Box, Card, CardBody, Heading, HStack, VStack } from "@chakra-ui/react";
import { useEffect } from "react";
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalFooter,
  ModalBody,
  ModalCloseButton,
  useDisclosure,
  Button,
  List,
  ListItem,
  ListIcon,
  OrderedList,
  UnorderedList,
  Image,
} from "@chakra-ui/react";

export const BookAMeeting = () => {
  const { isOpen, onOpen, onClose } = useDisclosure();

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
      <Modal isOpen={isOpen} onClose={onClose} size="4xl">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Book a Meeting</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Box width="full" height="690px">
              <iframe
                src="https://get.langwatch.ai/meetings/manouk-draisma/c-level?embed=true"
                frameBorder="0"
                width="100%"
                height="690px"
                allowFullScreen
              ></iframe>
            </Box>
          </ModalBody>
        </ModalContent>
      </Modal>
      <Card>
        <CardBody padding={12}>
          <HStack align="start" spacing={8}>
            <iframe
              width="420"
              height="280"
              src="https://www.youtube.com/embed/dZG44oRTz84"
            ></iframe>

            <VStack align="start" spacing={4}>
              <Heading as="h2" size="md">
                LangWatch Optimization Studio
              </Heading>
              <UnorderedList>
                <ListItem>
                  <b>Ensure quality</b> with a single click
                </ListItem>
                <ListItem>
                  <b>Upload your datasets</b> for easy performance tracking
                </ListItem>
                <ListItem>
                  <b>Automatically evaluate</b> the performance of your models
                </ListItem>
                <ListItem>
                  <b>Optimize</b> your solution using advanced DSPy algorithms
                  in a single click
                </ListItem>
              </UnorderedList>
              <Button colorScheme="orange" onClick={onOpen}>
                Get early access
              </Button>
            </VStack>
          </HStack>
        </CardBody>
      </Card>
    </>
  );
};
