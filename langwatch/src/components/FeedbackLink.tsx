import { Button, useDisclosure, VStack, Text } from "@chakra-ui/react";
import { Discord } from "./icons/Discord";
import { GitHub } from "./icons/GitHub";
import { Link } from "../components/ui/link";
import { Dialog } from "../components/ui/dialog";

export function FeedbackLink() {
  const { open, onOpen, setOpen } = useDisclosure();

  return (
    <>
      <Dialog.Root open={open} onOpenChange={({ open }) => setOpen(open)}>
        <Dialog.Backdrop />
        <Dialog.Content>
          <Dialog.Header>
            <Dialog.Title>Feedback on LangWatch</Dialog.Title>
          </Dialog.Header>
          <Dialog.CloseTrigger />
          <Dialog.Body>
            <VStack align="start" paddingBottom={4}>
              <Text paddingBottom={4}>
                Join our Discord community or open a Github Issue for any
                issues, questions or ideas.
              </Text>
              <Link href="https://discord.gg/kT4PhDS2gH" isExternal>
                <Button variant="plain">
                  <Discord /> Discord
                </Button>
              </Link>
              <Link href="https://github.com/langwatch/langwatch" isExternal>
                <Button variant="plain">
                  <GitHub /> Github
                </Button>
              </Link>
            </VStack>
          </Dialog.Body>
        </Dialog.Content>
      </Dialog.Root>
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
