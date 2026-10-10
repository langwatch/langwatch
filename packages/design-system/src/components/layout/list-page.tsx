import { Alert, Box, Skeleton, Stack, Text } from "@chakra-ui/react";
import type { ReactNode } from "react";

import { PageLayout } from "./page-layout.tsx";
import { Pagination, type PaginationProps } from "./pagination.tsx";

export interface ListPageProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  toolbar?: ReactNode;
  loading?: boolean;
  refreshing?: boolean;
  error?: ReactNode;
  empty?: ReactNode;
  pagination?: PaginationProps;
  children: ReactNode;
}

/** A controlled resource list: the caller owns data, filtering, and the table's columns. */
export function ListPage({
  title,
  subtitle,
  actions,
  toolbar,
  loading,
  refreshing,
  error,
  empty,
  pagination,
  children,
}: ListPageProps) {
  let content = (
    <>
      <Box minWidth="0" overflowX="auto">
        {empty ?? children}
      </Box>
      {!empty && pagination && <Pagination {...pagination} />}
    </>
  );
  if (error) content = <>{error}</>;
  else if (loading) content = <ListPageSkeleton />;

  return (
    <>
      <PageLayout.Header actions={actions} flexWrap="wrap">
        <Stack gap={1} minWidth={0}>
          <PageLayout.Heading>{title}</PageLayout.Heading>
          {subtitle && <PageLayout.Subtitle>{subtitle}</PageLayout.Subtitle>}
        </Stack>
      </PageLayout.Header>
      <PageLayout.Container maxWidth="full">
        <Stack gap={4} minWidth={0}>
          {toolbar && <Box minWidth={0}>{toolbar}</Box>}
          {refreshing && !loading && (
            <Text as="output" textStyle="xs" color="fg.muted">
              Refreshing…
            </Text>
          )}
          {content}
        </Stack>
      </PageLayout.Container>
    </>
  );
}

export function ListPageSkeleton({ label = "Loading records" }: { label?: string }) {
  return (
    <Stack gap={3} padding={4} aria-label={label} aria-busy="true">
      {Array.from({ length: 5 }, (_, row) => (
        <Skeleton key={row} height={8} />
      ))}
    </Stack>
  );
}

export function ListPageError({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <Alert.Root status="error" role="alert">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>{title}</Alert.Title>
        {children && <Alert.Description>{children}</Alert.Description>}
      </Alert.Content>
    </Alert.Root>
  );
}
