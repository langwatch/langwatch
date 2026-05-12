import { Box, Button, Heading, Text, VStack } from "@chakra-ui/react";
import { Ghost } from "lucide-react";
import { useRouteError } from "react-router";

import { Link } from "~/components/ui/link";

/**
 * Shared fallback for (a) unknown routes (path="*") and (b) errors thrown
 * during render / lazy loading (errorElement on the root layout). Replaces
 * React Router's dev-only "Hey developer 👋" default, which looked like a
 * crash to customers.
 */
export default function NotFoundOrErrorPage() {
  const error = useRouteError() as
    | { status?: number; statusText?: string; message?: string }
    | undefined;
  const status = error?.status ?? 404;
  const title =
    status === 404 ? "Page not found" : "Something went wrong";
  const description =
    status === 404
      ? "The URL you were headed to does not exist (anymore). Use the nav to get back on track."
      : error?.message ??
        "An unexpected error occurred. Try going back to the dashboard.";
  return (
    <Box
      minHeight="100vh"
      display="flex"
      alignItems="center"
      justifyContent="center"
      padding={8}
    >
      <VStack gap={4} maxWidth="480px" textAlign="center">
        <Box color="fg.muted">
          <Ghost size={48} />
        </Box>
        <Heading size="lg">{title}</Heading>
        <Text color="fg.muted">{description}</Text>
        <Link href="/">
          <Button colorPalette="orange">Back to dashboard</Button>
        </Link>
      </VStack>
    </Box>
  );
}
