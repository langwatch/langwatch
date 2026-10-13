import { Link } from "@langwatch/browser-host/link";
import { Dialog } from "@langwatch/design-system/dialog";
import { GitHubIcon as GitHub } from "@langwatch/design-system/icons";
import { Button, Text, useDisclosure, VStack } from "@langwatch/design-system/primitives";

import { Discord } from "./icons/discord.tsx";

export function FeedbackLink() {
  const { open, onOpen, setOpen } = useDisclosure();

  return (
    <>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Feedback on LangWatch"
        cancelLabel={null}
      >
        <VStack align="start" paddingBottom={4}>
          <Text paddingBottom={4}>
            Join our Discord community or open a Github Issue for any issues, questions or ideas.
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
      </Dialog>
      <Button variant="plain" onClick={onOpen} fontWeight="normal" color="fg">
        Give Feedback
      </Button>
    </>
  );
}
