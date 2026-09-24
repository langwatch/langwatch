import { Alert, Link } from "@chakra-ui/react";
import { hasRedactionMarker } from "@langwatch/redaction";
import type React from "react";

import NextLink from "../elements/next-link.tsx";

/**
 * Banner shown when trace content carries redaction markers.
 */
export function PIIRedactionNotice({ content }: { content: string | null | undefined }) {
  if (!hasRedactionMarker(content)) return null;
  return <PIIRedactionAlert />;
}

/**
 * The banner itself, for callers that decide on their own that content was redacted.
 * `children` replaces the sentence; the settings link stays either way.
 */
export function PIIRedactionAlert({ children }: { children?: React.ReactNode }) {
  const settingsHref = "/settings/data-privacy";

  return (
    <Alert.Root status="info" size="sm" variant="subtle" width="full">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Description fontSize="sm">
          {children ??
            "Some content was redacted by this project's privacy settings (PII or secrets redaction)."}{" "}
          Review your privacy settings under{" "}
          <Link asChild color="blue.600" textDecoration="underline">
            <NextLink href={settingsHref}>Settings</NextLink>
          </Link>
          .
        </Alert.Description>
      </Alert.Content>
    </Alert.Root>
  );
}
