import { Alert, Link } from "@chakra-ui/react";
import { hasRedactionMarker } from "@langwatch/redaction";
import NextLink from "~/utils/compat/next-link";

/**
 * Banner shown when trace content carries redaction markers.
 *
 * The trace-processing pipeline replaces matched PII and secret substrings
 * in-place with a typed marker (`[PHONE_NUMBER]`, `[SECRET]`, ...), which
 * leaves the message render altered to a casual reader. Multiple team members
 * reported "the gateway lost the payload" when the real cause was redaction
 * scrubbing content they did not know was being removed, let alone how to reach
 * the setting.
 *
 * This alert surfaces the privacy-settings link next to any trace that carries
 * redaction markers. It does NOT un-redact content.
 */
export function PIIRedactionNotice({ content }: { content: string | null | undefined }) {
  if (!hasRedactionMarker(content)) return null;
  return <PIIRedactionAlert />;
}

/**
 * The banner itself, for callers that decide on their own that content was
 * redacted. The conversation view scans every turn it parsed and shows one
 * banner for the whole thread rather than one per message, so it needs the
 * copy and the settings link without the single-string detection.
 */
export function PIIRedactionAlert() {
  const settingsHref = "/settings/data-privacy";

  return (
    <Alert.Root status="info" size="sm" variant="subtle" width="full">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Description fontSize="sm">
          Some content was redacted by this project's privacy settings (PII or secrets
          redaction). Review them under{" "}
          <Link asChild color="blue.600" textDecoration="underline">
            <NextLink href={settingsHref}>Settings</NextLink>
          </Link>
          .
        </Alert.Description>
      </Alert.Content>
    </Alert.Root>
  );
}
