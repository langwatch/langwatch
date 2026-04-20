import { Alert, Link } from "@chakra-ui/react";
import NextLink from "~/utils/compat/next-link";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

/**
 * Banner shown when trace content carries PII redaction markers.
 *
 * The trace-processing pipeline redacts matched PII substrings in-place
 * (Presidio anonymiser replaces the matched spans with "[REDACTED]"),
 * which leaves the message render empty or near-empty to a casual reader.
 * Multiple team members reported "the gateway lost the payload" when the
 * real cause was Strict-level PII redaction stripping names/locations
 * from their chat content — they didn't know the setting existed, let
 * alone how to reach it.
 *
 * This alert surfaces the setting link next to any trace that carries
 * redaction markers. It does NOT un-redact content.
 */
export function PIIRedactionNotice({
  content,
}: {
  content: string | null | undefined;
}) {
  const { project } = useOrganizationTeamProject();

  if (!content || !/\[REDACTED\]/.test(content)) return null;
  const settingsHref = project?.slug ? `/${project.slug}/settings` : "/settings";

  return (
    <Alert.Root status="info" size="sm" variant="subtle" width="full">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Description fontSize="sm">
          Some content was redacted by this project's PII redaction
          settings. Adjust the level (Strict / Essential / Disabled) under{" "}
          <Link asChild color="blue.600" textDecoration="underline">
            <NextLink href={settingsHref}>Settings → PII Redaction</NextLink>
          </Link>
          .
        </Alert.Description>
      </Alert.Content>
    </Alert.Root>
  );
}
