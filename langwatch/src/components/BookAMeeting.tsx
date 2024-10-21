import { Box } from "@chakra-ui/react";
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
      <Button onClick={onOpen}>Open Modal</Button>

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
      <Box width="full" height="300px" backgroundColor="red">
        {/* <iframe
        src="https://get.langwatch.ai/meetings/manouk-draisma/c-level?embed=true"
        frameBorder="0"
        width="100%"
        height="100%"
        allowFullScreen
      ></iframe> */}

        {/* <div
          className="meetings-iframe-container"
          data-src="https://get.langwatch.ai/meetings/manouk-draisma/c-level?embed=true"
        ></div> */}
        {/* <script
        type="text/javascript"
        src="https://static.hsappstatic.net/MeetingsEmbed/ex/MeetingsEmbedCode.js"
      ></script> */}
      </Box>
    </>
  );
};
