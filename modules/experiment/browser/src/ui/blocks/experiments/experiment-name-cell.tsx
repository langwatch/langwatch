import { Link } from "@langwatch/browser-host/link";
import { Badge, HStack, Text, VStack } from "@langwatch/design-system/primitives";

import type { ListDataset } from "../../../model/experiments/experiment-list-row.ts";

/**
 * The experiment's name as a same-tab link, how it ran as a small chip, and the dataset's name
 * only when something recorded it. Clicking any link leaves the row closed.
 */
export function ExperimentNameCell({
  name,
  href,
  kind,
  dataset,
  datasetHref,
}: {
  name: string;
  href: string;
  kind: string;
  dataset: ListDataset | undefined;
  datasetHref: string | undefined;
}) {
  return (
    <VStack align="start" gap={1} minWidth={0}>
      <Link
        href={href}
        title={name}
        textStyle="bodySm"
        fontWeight="medium"
        lineClamp={2}
        wordBreak="break-word"
        onClick={(e) => e.stopPropagation()}
      >
        {name}
      </Link>
      <Badge size="sm" variant="subtle" colorPalette="gray" title="How it ran">
        {kind}
      </Badge>
      {dataset && (
        <HStack gap={1} textStyle="caption" color="fg.muted" minWidth={0} maxWidth="full">
          <Text as="span" flexShrink={0}>
            Dataset
          </Text>
          {datasetHref ? (
            <Link
              href={datasetHref}
              color="fg"
              lineClamp={1}
              title={dataset.name}
              onClick={(e) => e.stopPropagation()}
            >
              {dataset.name}
            </Link>
          ) : (
            <Text as="span" color="fg" lineClamp={1} title={dataset.name}>
              {dataset.name}
            </Text>
          )}
          {dataset.extra > 0 && (
            <Text as="span" flexShrink={0}>
              +{dataset.extra} more
            </Text>
          )}
        </HStack>
      )}
    </VStack>
  );
}
