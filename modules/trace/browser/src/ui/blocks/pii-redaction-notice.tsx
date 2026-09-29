import { Alert, Link } from "@chakra-ui/react";
import { Link as RoutedLink } from "@langwatch/browser-host/link";
import { hasRedactionMarker } from "@langwatch/redaction";
import type React from "react";

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
    <Alert.Root status="info" size="sm" width="full">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Description>
          {children ??
            "Some content was redacted by this project's privacy settings (PII or secrets redaction)."}{" "}
          Review your privacy settings under{" "}
          <Link asChild color="blue.600" textDecoration="underline">
            <RoutedLink href={settingsHref}>Settings</RoutedLink>
          </Link>
          .
        </Alert.Description>
      </Alert.Content>
    </Alert.Root>
  );
}
