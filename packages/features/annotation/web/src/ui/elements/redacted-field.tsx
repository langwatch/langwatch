/**
 * The shared redacted-content marker: a lock and "Redacted", with a tooltip
 * saying who a privacy rule does let read it.
 *
 * A NARROWED FAMILY-LOCAL COPY of
 * `platform/app/src/components/ui/RedactedField`, which keeps thirteen callers
 * across the trace surfaces and so did not travel.
 *
 * WHAT THE NARROWING TOOK OUT is the explicit-props half. The platform
 * component can be driven either by its own per-field query or by a DTO's own
 * redaction flags, because the traces-v2 drawer passes what the server already
 * nulled; an annotation row has no such DTO, so this copy has one source of
 * truth and no branch. The "Open privacy settings" link is kept, and so is the
 * grant that decides whether to offer it.
 */

import { HStack, Icon, Skeleton, Text, VStack } from "@chakra-ui/react";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { Lock } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "./annotation-link";

/** What a privacy rule leaves readable, in words. */
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
 * Short label beside the lock, so a glance tells the reader who can see the
 * content without opening the tooltip. Null when the audience is unknown
 * (legacy redaction with no audience label), where the generic copy is enough.
 */
function audienceHint(visibleTo: string | null): string | null {
  if (!visibleTo) return null;
  if (visibleTo === "no one") return "hidden by privacy settings";
  return `visible to ${visibleTo}`;
}

export function RedactedInline({
  visibleTo = null,
  canOpenSettings,
}: {
  visibleTo?: string | null;
  canOpenSettings: boolean;
}) {
  const hint = audienceHint(visibleTo);
  return (
    <Tooltip
      interactive
      content={
        <VStack align="start" gap={1}>
          <Text>{explanationFor(visibleTo)}</Text>
          {canOpenSettings && (
            <Link
              href="/settings/data-privacy"
              isExternal
              color="inherit"
              textDecoration="underline"
            >
              Open privacy settings
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

export function RedactedField({
  isRedacted,
  isLoading,
  visibleTo,
  canOpenSettings,
  children,
}: {
  /** Undefined while the answer has not arrived. */
  isRedacted: boolean | undefined;
  isLoading: boolean;
  visibleTo: string | null;
  canOpenSettings: boolean;
  children: ReactNode;
}) {
  if (isLoading || isRedacted === void 0) {
    return <Skeleton height="20px" width="100%" />;
  }
  if (isRedacted) {
    return <RedactedInline visibleTo={visibleTo} canOpenSettings={canOpenSettings} />;
  }
  return <>{children}</>;
}
