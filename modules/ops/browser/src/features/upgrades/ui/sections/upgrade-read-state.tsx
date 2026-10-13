import { Skeleton, VStack } from "@langwatch/design-system/primitives";
import { HandledErrorAlert } from "@langwatch/error-views";
import type { ReactNode } from "react";

/** The fields of a read every Upgrades page shows: its answer, or why there is none. */
type UpgradeRead<Data> = { data: Data | undefined; isError: boolean; error: unknown };

/** A read's answer, its refusal named, or a skeleton while it loads. */
export function UpgradeReadState<Data>({
  read,
  failedTitle,
  children,
}: {
  read: UpgradeRead<Data>;
  failedTitle: string;
  children: (data: Data) => ReactNode;
}) {
  if (read.data !== undefined) return <>{children(read.data)}</>;
  if (read.isError) return <HandledErrorAlert error={read.error} fallbackTitle={failedTitle} />;
  return (
    <VStack gap={3} align="stretch" aria-label="Loading">
      <Skeleton height="96px" />
      <Skeleton height="240px" />
    </VStack>
  );
}
