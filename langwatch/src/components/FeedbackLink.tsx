import {
  Button,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalHeader,
  ModalOverlay,
  Text,
  VStack,
  useDisclosure,
} from "@chakra-ui/react";
import NextLink from "next/link";
import { Discord } from "./icons/Discord";
import { GitHub } from "./icons/GitHub";

export function FeedbackLink() {
  const { isOpen, onOpen, onClose } = useDisclosure();

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose}>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Feedback on LangWatch</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <VStack align="start" paddingBottom={4}>
              <Text paddingBottom={4}>
                Join our Discord community or open a Github Issue for any
                issues, questions or ideas.
              </Text>
              <NextLink
                href="https://discord.gg/kT4PhDS2gH"
                target="_blank"
                passHref
              >
                <Button as="span" variant="plain" leftIcon={<Discord />}>
                  Discord
                </Button>
              </NextLink>
              <NextLink
                href="https://github.com/langwatch/langwatch"
                target="_blank"
                passHref
              >
                <Button as="span" variant="plain" leftIcon={<GitHub />}>
                  Github
                </Button>
              </NextLink>
            </VStack>
          </ModalBody>
        </ModalContent>
      </Modal>
      <Button
        variant="plain"
        onClick={onOpen}
        fontWeight="normal"
        color="gray.800"
      >
        Give Feedback
      </Button>
    </>
  );
}
