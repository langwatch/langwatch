import { Alert, Button } from "@chakra-ui/react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import NextLink from "~/utils/compat/next-link";

/**
 * Banner shown when a trace is missing content because a `drop` privacy policy
 * stripped it before storage.
 *
 * Dropped content never reached storage, so the field renders empty. Without a
 * marker that reads as missing instrumentation, which sends people hunting for a
 * broken SDK when the cause is a deliberate policy. This notice names the
 * categories that were dropped and makes clear the content was never stored and
 * cannot be recovered (unlike a read-time restriction, which keeps the data and
 * only hides who can read it).
 *
 * The categories come from a marker the drop stamps on the span, so the notice
 * follows the data: traces from before a rule was added are not mislabeled.
 */
const CATEGORY_LABELS: Record<string, string> = {
  input: "input",
  output: "output",
  system: "system instructions",
  tools: "tool calls",
};

function describeCategories(categories: string[]): string {
  const labels = categories.map(
    (category) => CATEGORY_LABELS[category] ?? category,
  );
  if (labels.length === 1) return labels[0]!;
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

export function PrivacyDroppedNotice({
  categories,
}: {
  categories?: string[] | null;
}) {
  const { hasPermission } = useOrganizationTeamProject();
  if (!categories || categories.length === 0) return null;

  const single = categories.length === 1;
  const list = describeCategories(categories);
  const wasWere = single ? "was" : "were";
  const itThey = single ? "it is" : "they are";
  const itTheyWere = single ? "it was" : "they were";

  return (
    <Alert.Root status="info" size="sm" variant="subtle" width="full">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Description fontSize="sm">
          The {list} {wasWere} dropped by this project's privacy settings before{" "}
          {itTheyWere} stored, so {itThey} not shown here and cannot be
          recovered.
        </Alert.Description>
        {hasPermission("project:view") && (
          <Button
            asChild
            size="xs"
            variant="outline"
            marginTop={1}
            alignSelf="start"
          >
            <NextLink
              href="/settings/data-privacy"
              target="_blank"
              rel="noopener noreferrer"
            >
              Privacy settings
            </NextLink>
          </Button>
        )}
      </Alert.Content>
    </Alert.Root>
  );
}
