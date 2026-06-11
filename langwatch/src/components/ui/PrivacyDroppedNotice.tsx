import { Alert } from "@chakra-ui/react";

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
  const labels = categories.map((category) => CATEGORY_LABELS[category] ?? category);
  if (labels.length === 1) return labels[0]!;
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

export function PrivacyDroppedNotice({
  categories,
}: {
  categories?: string[] | null;
}) {
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
      </Alert.Content>
    </Alert.Root>
  );
}
