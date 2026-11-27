import { Box, Button, Link, Text } from "@langwatch/design-system/primitives";

/**
 * The cookie notice, rendered hidden: the tag manager island shows it only to a reader who has not
 * chosen on the docs or the marketing site. It sits outside the layout, so navigation keeps it.
 */
export function CookieNotice() {
  return (
    <Box
      id="docs-cookie-notice"
      as="aside"
      aria-labelledby="docs-cookie-notice-title"
      hidden
      position="fixed"
      insetX={{ base: "4", md: "auto" }}
      bottom={{ base: "4", md: "6" }}
      left={{ md: "6" }}
      maxWidth={{ md: "400px" }}
      zIndex="overlay"
      bg="bg.panel"
      color="fg"
      borderWidth="1px"
      borderColor="border"
      borderRadius="lg"
      boxShadow="lg"
      padding="5"
    >
      <Text as="h2" id="docs-cookie-notice-title" fontSize="sm" fontWeight="semibold" margin="0">
        Cookies
      </Text>
      <Text fontSize="sm" color="fg.muted" marginTop="2" marginBottom="0">
        We use cookies to analyse traffic and improve your experience. Accept to allow analytics
        cookies, or decline to keep only what's needed.{" "}
        <Link
          href="https://langwatch.ai/legal/privacy-policy"
          color="fg"
          textDecoration="underline"
        >
          Privacy policy
        </Link>
        .
      </Text>
      <Box display="flex" gap="2" marginTop="4">
        <Button
          type="button"
          size="sm"
          flex="1"
          bg="fg"
          color="bg.surface"
          _hover={{ bg: "docs.body" }}
          data-docs-consent="accepted"
        >
          Accept
        </Button>
        <Button type="button" size="sm" flex="1" variant="outline" data-docs-consent="declined">
          Decline
        </Button>
      </Box>
    </Box>
  );
}
