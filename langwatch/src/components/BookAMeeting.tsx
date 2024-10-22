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

              {/* <div
                className="meetings-iframe-container"
                data-src="https://get.langwatch.ai/meetings/manouk-draisma/c-level?embed=true"
              ></div> */}
              {/* <script
        type="text/javascript"
        src="https://static.hsappstatic.net/MeetingsEmbed/ex/MeetingsEmbedCode.js"
      ></script> */}
            </Box>
          </ModalBody>
        </ModalContent>
      </Modal>
      <Card>
        <CardBody>
          <HStack>
            <Box width="full" height="300px" backgroundColor="red"></Box>

            <VStack align="start">
              <Heading as="h2" size="md">
                Optimize your product with LangWatch
              </Heading>
              <UnorderedList>
                <ListItem>Ensure quality with a single click</ListItem>
                <ListItem>
                  Upload your datasets for easy performance tracking
                </ListItem>
                <ListItem>
                  Automatically evaluate the efficiency of your models
                </ListItem>
                <ListItem>
                  Optimize your solution using advanced DSPy algorithms in a
                  single click{" "}
                </ListItem>
              </UnorderedList>
              <Button colorScheme="orange" onClick={onOpen}>
                Chat with us for access
              </Button>
            </VStack>
          </HStack>
        </CardBody>
      </Card>
    </>
  );
};
