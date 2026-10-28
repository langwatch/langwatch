"use client";

import { Badge, HStack, Text, VStack } from "@chakra-ui/react";

/** One saved version as the list shows it; the owning module words the date. */
export interface VersionListItem {
  id: string;
  version: number;
  labels: readonly string[];
  commitMessage: string | null;
  /** The user who wrote it; null for an API key or LangWatch itself. */
  author: { name: string | null; email: string | null } | null;
  authorKind: string | null;
  createdAtLabel: string;
}

export interface VersionListProps {
  versions: readonly VersionListItem[];
  "data-testid"?: string;
}

/** Every saved version, newest first, with the deploy labels it carries. */
export function VersionList({ versions, "data-testid": testId }: VersionListProps) {
  return (
    <VStack align="stretch" gap={2} data-testid={testId}>
      <Text fontWeight="semibold" fontSize="sm">
        Versions
      </Text>
      {versions.map((row) => (
        <VStack
          key={row.id}
          align="start"
          gap={0}
          borderWidth="1px"
          borderColor="border.muted"
          borderRadius="md"
          paddingX={3}
          paddingY={2}
        >
          <HStack gap={2}>
            <Text fontFamily="mono" fontSize="sm" fontWeight="semibold">
              v{row.version}
            </Text>
            {row.labels.map((label) => (
              <Badge key={label} size="xs" variant="subtle" colorPalette="green">
                {label}
              </Badge>
            ))}
          </HStack>
          {row.commitMessage && (
            <Text fontSize="sm" truncate maxWidth="100%">
              {row.commitMessage}
            </Text>
          )}
          <Text color="fg.muted" fontSize="xs">
            {authorOf(row)} · {row.createdAtLabel}
          </Text>
        </VStack>
      ))}
    </VStack>
  );
}

function authorOf(row: VersionListItem): string {
  if (row.author) return row.author.name ?? row.author.email ?? "Unknown user";
  if (row.authorKind === "api_key") return "API key";
  return row.authorKind === "user" ? "Unknown user" : "LangWatch";
}
