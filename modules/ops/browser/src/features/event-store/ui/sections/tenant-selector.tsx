import {
  Badge,
  Button,
  Card,
  HStack,
  TagsInput,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { SearchInput } from "@langwatch/design-system/search-input";
import { HandledErrorAlert } from "@langwatch/error-views";
import { useState } from "react";

import { api } from "../../../../behavior/ops-api.ts";

export function TenantSelector({
  tenantIds,
  onTenantIdsChange,
}: {
  tenantIds: string[];
  onTenantIdsChange: (ids: string[]) => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const searchResults = api.ops.searchTenants.useQuery(
    { query: searchQuery },
    { enabled: searchQuery.length >= 2 },
  );

  return (
    <VStack align="stretch" gap={2}>
      <TagsInput.Root
        size="sm"
        value={tenantIds}
        onValueChange={(details) => onTenantIdsChange(details.value)}
        addOnPaste
        delimiter=","
        blurBehavior="add"
        validate={(e) => e.inputValue.trim().length > 0}
      >
        <TagsInput.Label>
          <Text textStyle="xs" color="fg.muted">
            Tenants
          </Text>
        </TagsInput.Label>
        <TagsInput.Control>
          <TagsInput.Items />
          <TagsInput.Input placeholder="Type tenant ID and press Enter..." />
          <TagsInput.ClearTrigger />
        </TagsInput.Control>
      </TagsInput.Root>

      <VStack align="stretch" gap={2}>
        <SearchInput
          size="sm"
          containerProps={{ width: "full", minWidth: 0 }}
          aria-label="Search tenants"
          placeholder="Search tenants by name or ID..."
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
        />
        {searchQuery.length >= 2 && searchResults.isFetching && (
          <Text as="output" textStyle="xs" color="fg.muted">
            Searching tenants…
          </Text>
        )}
        {searchResults.isError && (
          <HandledErrorAlert error={searchResults.error} fallbackTitle="Tenants could not load" />
        )}
        {searchQuery.length >= 2 && searchResults.isSuccess && searchResults.data.length === 0 && (
          <Text textStyle="sm" color="fg.muted">
            No matching tenants.
          </Text>
        )}
        {searchResults.data && searchResults.data.length > 0 && (
          <Card.Root variant="outline">
            <Card.Body gap={1} maxHeight="48" overflowY="auto">
              {searchResults.data.map((tenant) => (
                <Button
                  key={tenant.id}
                  variant="ghost"
                  justifyContent="start"
                  height="auto"
                  whiteSpace="normal"
                  paddingY={2}
                  onClick={() => {
                    if (!tenantIds.includes(tenant.id)) {
                      onTenantIdsChange([...tenantIds, tenant.id]);
                    }
                    setSearchQuery("");
                  }}
                >
                  <HStack gap={2} wrap="wrap" minWidth={0}>
                    <Text textStyle="xs" fontWeight="medium">
                      {tenant.name}
                    </Text>
                    <Text textStyle="xs" color="fg.muted" fontFamily="mono">
                      {tenant.id}
                    </Text>
                    {tenantIds.includes(tenant.id) && (
                      <Badge size="sm" colorPalette="green">
                        added
                      </Badge>
                    )}
                  </HStack>
                </Button>
              ))}
            </Card.Body>
          </Card.Root>
        )}
      </VStack>
    </VStack>
  );
}
