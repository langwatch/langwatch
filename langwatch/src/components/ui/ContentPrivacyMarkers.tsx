import { Alert, HStack, Icon, Link, Text, VStack } from "@chakra-ui/react";
import type React from "react";
import { Eye, Lock, Slash } from "react-feather";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type {
  CategoryPrivacy,
  ContentPrivacy,
} from "~/server/api/routers/tracesV2.schemas";
import NextLink from "~/utils/compat/next-link";
import { Tooltip } from "./tooltip";

/**
 * Generic, per-category read-time privacy markers for a span's content. Every
 * content category (input, output, system instructions, tool calls) is marked
 * the same way so an absent or hidden category never reads as missing
 * instrumentation:
 *
 * - dropped: removed by a privacy policy at ingestion, not stored, unrecoverable.
 * - restricted (hidden): stored but hidden from this viewer; names who can see.
 * - restricted (visible to you): the viewer is in the audience, so the content
 *   shows, with a marker telling them it is limited to that audience.
 *
 * Categories that are plainly captured and visible render nothing.
 */

type Category = keyof ContentPrivacy;

const CATEGORY_LABELS: Record<Category, string> = {
  input: "Input",
  output: "Output",
  system: "System instructions",
  tools: "Tool calls",
};

interface MarkerCopy {
  icon: React.ComponentType;
  label: string;
  tooltip: string;
}

/**
 * The marker copy for one category's status, or null when there is nothing to
 * mark. `skipRestricted` suppresses the restricted-hidden marker for categories
 * whose hidden state already renders inline (input/output, via RedactedField),
 * leaving the dropped marker and the in-audience badge.
 */
function markerFor(
  category: Category,
  status: CategoryPrivacy | undefined,
  skipRestricted: boolean,
): MarkerCopy | null {
  if (!status) return null;
  const name = CATEGORY_LABELS[category];

  if (status.state === "dropped") {
    return {
      icon: Slash,
      label: `${name} not stored`,
      tooltip: `${name} was removed by a privacy policy before it was stored, so it is not shown here and cannot be recovered.`,
    };
  }

  if (status.state === "restricted") {
    if (skipRestricted) return null;
    const audience = status.visibleTo;
    return {
      icon: Lock,
      label: audience
        ? `${name} hidden (visible to ${audience})`
        : `${name} hidden`,
      tooltip:
        audience && audience !== "no one"
          ? `A privacy rule limits who can read the ${name.toLowerCase()}. Visible to: ${audience}.`
          : `A privacy rule keeps the ${name.toLowerCase()} hidden from everyone: it is stored, but no audience is allowed to read it.`,
    };
  }

  // Visible: a non-null label means restricted but THIS viewer is in the
  // audience, so tell them so instead of presenting it as ordinary content.
  if (status.visibleTo) {
    return {
      icon: Eye,
      label: `${name} visible to ${status.visibleTo}`,
      tooltip: `A privacy rule limits who can read the ${name.toLowerCase()}. You can see it because you are in the audience: ${status.visibleTo}.`,
    };
  }

  return null;
}

const PrivacyMarker: React.FC<MarkerCopy> = ({ icon, label, tooltip }) => {
  const { hasPermission } = useOrganizationTeamProject();
  const canOpenSettings = hasPermission("project:view");
  return (
    <Tooltip
      interactive
      content={
        <VStack align="start" gap={1}>
          <Text>{tooltip}</Text>
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
        fontSize="sm"
        gap={1}
        cursor="default"
        display="inline-flex"
      >
        <Icon as={icon} boxSize={3} />
        <Text>{label}</Text>
      </HStack>
    </Tooltip>
  );
};

/**
 * Renders the privacy markers for the given categories (defaults to all four).
 * Categories with nothing to mark render nothing, so the block is invisible for
 * ordinary captured content.
 */
export const ContentPrivacyMarkers: React.FC<{
  privacy?: ContentPrivacy | null;
  categories?: readonly Category[];
  skipRestricted?: boolean;
}> = ({
  privacy,
  categories = ["input", "output", "system", "tools"],
  skipRestricted = false,
}) => {
  if (!privacy) return null;
  const markers = categories
    .map((category) => ({
      category,
      copy: markerFor(category, privacy[category], skipRestricted),
    }))
    .filter(
      (m): m is { category: Category; copy: MarkerCopy } => m.copy !== null,
    );

  if (markers.length === 0) return null;

  return (
    <VStack align="start" gap={1}>
      {markers.map(({ category, copy }) => (
        <PrivacyMarker key={category} {...copy} />
      ))}
    </VStack>
  );
};

/**
 * Warns that strict redaction of names and locations did not run for a span, so
 * the content may still contain them — the pattern-based identifiers (emails,
 * cards, IDs) were still removed. Surfaces the gap instead of letting partially
 * redacted content read as fully scrubbed.
 */
export const PiiIncompleteNotice: React.FC<{
  incomplete?: boolean | null;
}> = ({ incomplete }) => {
  if (!incomplete) return null;
  return (
    <Alert.Root status="warning" size="sm" variant="subtle" width="full">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Description fontSize="sm">
          Name and location redaction did not run for this span, so the content
          may still contain names or locations. Emails, card numbers, and other
          identifiers were still removed.
        </Alert.Description>
      </Alert.Content>
    </Alert.Root>
  );
};
