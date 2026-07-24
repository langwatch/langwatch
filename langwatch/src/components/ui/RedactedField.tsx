import { HStack, Icon, Link, Skeleton, Text, VStack } from "@chakra-ui/react";
import type React from "react";
import { Lock } from "react-feather";
import { useFieldRedaction } from "~/hooks/useFieldRedaction";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import NextLink from "~/utils/compat/next-link";
import { Tooltip } from "./tooltip";

interface RedactedFieldProps {
  field: "input" | "output";
  children: React.ReactNode;
  loadingComponent?: React.ReactNode;
  /**
   * When provided, drives the redaction state directly instead of the per-field
   * query: the traces-v2 drawer passes the DTO's own redaction info so the
   * marker can never disagree with the content the server already nulled.
   * `visibleTo` is the human audience label ("Admins, Security group" or "no
   * one"), or null for the generic copy.
   */
  redacted?: boolean;
  visibleTo?: string | null;
}

/**
 * Short label shown next to the lock, so a glance tells the reader who can see
 * the content without opening the tooltip. Null when the audience is unknown
 * (legacy redaction with no audience label), where the generic copy is enough.
 */
function audienceHint(visibleTo: string | null): string | null {
  if (!visibleTo) return null;
  if (visibleTo === "no one") return "hidden by privacy settings";
  return `visible to ${visibleTo}`;
}

function explanationFor(visibleTo: string | null): string {
  if (!visibleTo) {
    return "This field is redacted based on your permissions and the project's privacy settings.";
  }
  if (visibleTo === "no one") {
    return "A privacy rule keeps this content hidden from everyone: it is stored, but no audience is allowed to read it.";
  }
  return `A privacy rule limits who can read this content. Visible to: ${visibleTo}.`;
}

/**
 * The shared redacted-content marker: a lock + "Redacted" with an optional
 * audience hint and a tooltip that links to the privacy settings. This is the
 * ONE redaction treatment every traces-v2 surface reuses (summary I/O, span
 * I/O, conversation context, conversation view, table cells) so a redacted
 * field reads identically everywhere instead of each surface inventing its own
 * "no content" placeholder.
 *
 * Kept as its own component so the organization/permission lookup it needs for
 * the "Open privacy settings" link only runs when content is actually redacted,
 * never for content that renders normally (the common case, which may render
 * outside an org context).
 *
 * `size="xs"` shrinks the lock + text for dense rows (table cells, the
 * conversation-context strip); the default reads at the drawer's `sm` body size.
 */
export const RedactedInline: React.FC<{
  visibleTo?: string | null;
  size?: "xs" | "sm";
}> = ({ visibleTo = null, size = "sm" }) => {
  const { hasPermission } = useOrganizationTeamProject();
  const hint = audienceHint(visibleTo);
  const canOpenSettings = hasPermission("project:view");
  return (
    <Tooltip
      interactive
      content={
        <VStack align="start" gap={1}>
          <Text>{explanationFor(visibleTo)}</Text>
          {canOpenSettings && (
            <Link asChild color="inherit" textDecoration="underline">
              <NextLink
                href="/settings/data-privacy"
                target="_blank"
                rel="noopener noreferrer"
              >
                Open privacy settings
              </NextLink>
            </Link>
          )}
        </VStack>
      }
    >
      <HStack
        color="fg.muted"
        fontStyle="italic"
        fontSize={size}
        gap={1}
        cursor="default"
        display="inline-flex"
      >
        <Icon as={Lock} boxSize={size === "xs" ? 2.5 : 3} />
        <Text>Redacted</Text>
        {hint && <Text>({hint})</Text>}
      </HStack>
    </Tooltip>
  );
};

export const RedactedField: React.FC<RedactedFieldProps> = ({
  field,
  children,
  loadingComponent,
  redacted,
  visibleTo: visibleToProp,
}) => {
  const query = useFieldRedaction(field);

  const explicit = redacted !== undefined;
  const isRedacted = explicit ? redacted : query.isRedacted;
  const isLoading = explicit ? false : query.isLoading;
  const visibleTo = explicit ? (visibleToProp ?? null) : query.visibleTo;

  if (isLoading || isRedacted === undefined) {
    return <>{loadingComponent ?? <Skeleton height="20px" width="100%" />}</>;
  }

  if (isRedacted) {
    return <RedactedInline visibleTo={visibleTo} />;
  }

  return <>{children}</>;
};
