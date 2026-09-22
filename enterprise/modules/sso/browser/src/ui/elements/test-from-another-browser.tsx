// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Testing the connection as somebody who is not you. What gets copied is a
 * link to THIS PAGE, never the sign-in: starting one mints a state and leaves
 * a signed copy in a cookie on the browser that asked, so a copied
 * authorization address refuses every time. Spec: sso-activation.feature.
 */
import { Button, Text, VStack } from "@chakra-ui/react";
import { toaster } from "@langwatch/design-system/toaster";
import { Copy } from "lucide-react";

export function TestFromAnotherBrowser() {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toaster.create({
        title: "Link copied",
        description: "Open it in the other browser and press Test sign-in there.",
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
        Open it in a profile signed in as somebody else and press Test sign-in there. The sign-in
        has to start in the browser that finishes it, so this copies the page rather than the
        sign-in itself.
      </Text>
    </VStack>
  );
}
