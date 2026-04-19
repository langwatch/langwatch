import { useState } from "react";
import { Badge, Box, HStack, TagsInput, Text, VStack } from "@chakra-ui/react";
import { Search } from "lucide-react";
import { api } from "~/utils/api";

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

      <Box position="relative">
        <HStack
          gap={2}
          borderWidth="1px"
          borderRadius="md"
          paddingX={3}
          paddingY={1.5}
        >
          <Search size={12} color="var(--chakra-colors-fg-muted)" />
          <input
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              fontSize: "12px",
              color: "inherit",
            }}
            placeholder="Search tenants by name or ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </HStack>
        {searchResults.data && searchResults.data.length > 0 && (
          <Box
            position="absolute"
            zIndex={10}
            width="full"
            borderWidth="1px"
            borderRadius="md"
            bg="bg.panel"
            shadow="md"
            maxHeight="200px"
            overflowY="auto"
            marginTop={1}
          >
            {searchResults.data.map((tenant) => (
              <Box
                key={tenant.id}
                paddingX={3}
                paddingY={2}
                cursor="pointer"
                _hover={{ bg: "bg.subtle" }}
                onClick={() => {
                  if (!tenantIds.includes(tenant.id)) {
                    onTenantIdsChange([...tenantIds, tenant.id]);
                  }
                  setSearchQuery("");
                }}
              >
                <HStack gap={2}>
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
              </Box>
            ))}
          </Box>
        )}
      </Box>
    </VStack>
  );
}
