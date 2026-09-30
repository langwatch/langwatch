/**
 * One independently readable fact about a page's subject: an icon and a label,
 * a large figure, an optional meter against a limit, an optional hint. Tiles
 * sit in a `StatTileGrid`. Presentational only: no fetching, no module words.
 */
import { Card, HStack, SimpleGrid, Skeleton, Text, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";

import { MeterBar } from "./meter-bar.tsx";

export interface StatTileMeter {
  current: number;
  /** The limit. A limit of zero or less has no track to fill, so no meter shows. */
  max: number;
}

export interface StatTileProps {
  label: string;
  icon?: ReactNode;
  /** Under the figure, clamped to two lines. */
  hint?: string;
  /** Draws the figure's share of a limit as a thin bar under it. */
  meter?: StatTileMeter;
  /** The figure: a `StatTileFigure`, or a chip or phrase in its place. */
  children: ReactNode;
  "data-testid"?: string;
}

export function StatTile({
  label,
  icon,
  hint,
  meter,
  children,
  "data-testid": testId,
}: StatTileProps) {
  return (
    <Card.Root borderRadius="xl" minWidth={0} data-testid={testId}>
      <Card.Body paddingX={4} paddingY={3}>
        <VStack align="start" gap={1.5} minWidth={0}>
          <HStack gap={1.5} color="fg.muted">
            {icon}
            <Text fontSize="xs" fontWeight={500} lineHeight="1.3">
              {label}
            </Text>
          </HStack>
          <HStack align="center" minWidth={0} maxWidth="full">
            {children}
          </HStack>
          {meter && meter.max > 0 && (
            <MeterBar
              fillRatio={meter.current / meter.max}
              width="full"
              height="4px"
              fillColor={meter.current >= meter.max ? "red.solid" : "orange.solid"}
              data-testid={testId ? `${testId}-meter` : undefined}
            />
          )}
          {hint && (
            <Text fontSize="xs" color="fg.muted" lineHeight="1.35" title={hint} lineClamp={2}>
              {hint}
            </Text>
          )}
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}

/** A tile's big figure: a number, or a phrase in its place when `muted`. */
export function StatTileFigure({
  children,
  muted = false,
  title,
  "data-testid": testId,
}: {
  children: ReactNode;
  muted?: boolean;
  title?: string;
  "data-testid"?: string;
}) {
  return (
    <Text
      fontSize="lg"
      lineHeight="1.3"
      fontWeight={muted ? 400 : 600}
      color={muted ? "fg.muted" : void 0}
      fontVariantNumeric="tabular-nums"
      truncate
      maxWidth="full"
      title={title}
      data-testid={testId}
    >
      {children}
    </Text>
  );
}

/** The grid tiles sit in: one column on a phone, two on a tablet, `columns` on a desktop. */
export function StatTileGrid({ columns, children }: { columns: number; children: ReactNode }) {
  return (
    <SimpleGrid columns={{ base: 1, sm: 2, lg: columns }} gap={3} width="full">
      {children}
    </SimpleGrid>
  );
}

/** The grid while the facts load: same tile footprint, nothing readable yet. */
export function StatTileSkeleton({
  columns,
  count = columns,
}: {
  columns: number;
  count?: number;
}) {
  return (
    <SimpleGrid columns={{ base: 1, sm: 2, lg: columns }} gap={3} width="full" aria-busy="true">
      {Array.from({ length: count }, (_, tile) => (
        <Card.Root key={tile} borderRadius="xl" minWidth={0}>
          <Card.Body paddingX={4} paddingY={3}>
            <VStack align="start" gap={1.5} minWidth={0}>
              <Skeleton height="3" width="16" />
              <Skeleton height="5" width="24" />
            </VStack>
          </Card.Body>
        </Card.Root>
      ))}
    </SimpleGrid>
  );
}
