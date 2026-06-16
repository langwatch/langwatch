import { HStack, Icon, Link, Skeleton, Text, VStack } from "@chakra-ui/react";
import NextLink from "~/utils/compat/next-link";
import type React from "react";
import { Lock } from "react-feather";
import { useFieldRedaction } from "~/hooks/useFieldRedaction";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
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

export const RedactedField: React.FC<RedactedFieldProps> = ({
  field,
  children,
  loadingComponent,
  redacted,
  visibleTo: visibleToProp,
}) => {
  const query = useFieldRedaction(field);
  const { hasPermission } = useOrganizationTeamProject();

  const explicit = redacted !== undefined;
  const isRedacted = explicit ? redacted : query.isRedacted;
  const isLoading = explicit ? false : query.isLoading;
  const visibleTo = explicit ? (visibleToProp ?? null) : query.visibleTo;

  if (isLoading || isRedacted === undefined) {
    return <>{loadingComponent ?? <Skeleton height="20px" width="100%" />}</>;
  }

  if (isRedacted) {
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
                <NextLink href="/settings/data-privacy">
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
          fontSize="sm"
          gap={1}
          cursor="default"
          display="inline-flex"
        >
          <Icon as={Lock} boxSize={3} />
          <Text>Redacted</Text>
          {hint && <Text>({hint})</Text>}
        </HStack>
      </Tooltip>
    );
  }

  return <>{children}</>;
};
