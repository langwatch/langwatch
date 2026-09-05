import { Button, Text, VStack } from "@chakra-ui/react";
import { Copy } from "lucide-react";
import { toaster } from "~/components/ui/toaster";

/**
 * Testing the connection as somebody who is not you.
 *
 * The obvious offer is a copy of the SIGN-IN link — press it in another
 * browser profile, arrive as a different identity-provider user. It cannot
 * work, and it is worth writing down why so nobody builds it again.
 *
 * Starting a sign-in mints a `state` and puts a signed copy of it in a cookie
 * on the browser that asked. The callback checks the state in the address
 * against that cookie, and refuses when they disagree — that check is what
 * stops somebody being walked through a sign-in they did not begin. A copied
 * authorization URL carries the state and leaves the cookie behind, so pasting
 * it into another profile produces `state_security_mismatch` every single
 * time. The only way to make it work is to switch the check off, which would
 * weaken every sign-in on the installation to save one test a step.
 *
 * So what gets copied is a link to THIS PAGE. The administrator opens it in
 * the other profile and presses the button there: the ceremony then begins and
 * ends in the same browser, which is the whole point of the check, and they
 * still arrive at their identity provider as whoever that profile is signed in
 * as.
 */
export function TestFromAnotherBrowser() {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toaster.create({
        title: "Link copied",
        description:
          "Open it in the other browser and press Test sign-in there.",
        type: "success",
        duration: 5000,
      });
    } catch {
      // A clipboard the browser refused is not worth a red alert: the address
      // bar is right there, and saying so is more use than an apology.
      toaster.create({
        title: "Couldn't reach your clipboard",
        description: "Copy this page's address from the address bar instead.",
        type: "info",
        duration: 6000,
      });
    }
  };

  return (
    <VStack align="start" gap={0.5}>
      <Button size="sm" variant="ghost" onClick={() => void copy()}>
        <Copy size={14} />
        Copy a link to test from another browser
      </Button>
      <Text fontSize="xs" color="fg.muted" paddingLeft={3} maxWidth="60ch">
        Open it in a profile signed in as somebody else and press Test sign-in
        there. The sign-in has to start in the browser that finishes it, so this
        copies the page rather than the sign-in itself.
      </Text>
    </VStack>
  );
}
