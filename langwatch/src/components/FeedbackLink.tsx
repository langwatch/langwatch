import { Button, Text, useDisclosure, VStack } from "@chakra-ui/react";
import { Dialog } from "../components/ui/dialog";
import { Link } from "../components/ui/link";
import { Discord } from "./icons/Discord";
import { GitHub } from "./icons/GitHub";

export function FeedbackLink() {
  const { open, onOpen, setOpen } = useDisclosure();

  return (
    <>
      <Dialog.Root open={open} onOpenChange={({ open }) => setOpen(open)}>
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
        color="fg"
      >
        Give Feedback
      </Button>
    </>
  );
}
