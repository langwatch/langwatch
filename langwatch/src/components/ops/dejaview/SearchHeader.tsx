import { Button, HStack, Input, Text } from "@chakra-ui/react";
import { Search } from "lucide-react";

export function SearchHeader({
  searchQuery,
  tenantFilter,
  onSearchQueryChange,
  onTenantFilterChange,
  onSearch,
  isLoading,
}: {
  searchQuery: string;
  tenantFilter: string;
  onSearchQueryChange: (value: string) => void;
  onTenantFilterChange: (value: string) => void;
  onSearch: () => void;
  isLoading: boolean;
}) {
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") onSearch();
  }

  return (
    <HStack
      height="48px"
      flexShrink={0}
      paddingX={6}
      width="full"
      borderBottom="1px solid"
      borderBottomColor="border"
      gap={3}
      position="sticky"
      top={0}
      zIndex={10}
      background="bg.surface"
    >
      <Text textStyle="md" fontWeight="semibold" flexShrink={0}>
        Deja View
      </Text>
      <Input
        size="sm"
        placeholder="Search aggregate ID..."
        value={searchQuery}
        onChange={(e) => onSearchQueryChange(e.target.value)}
        onKeyDown={handleKeyDown}
        flex={1}
      />
      <Input
        size="sm"
        placeholder="Tenant ID (optional)"
        value={tenantFilter}
        onChange={(e) => onTenantFilterChange(e.target.value)}
        onKeyDown={handleKeyDown}
        width="200px"
        flexShrink={0}
      />
      <Button
        size="sm"
        variant="outline"
        onClick={onSearch}
        loading={isLoading}
        flexShrink={0}
      >
        <Search size={14} />
      </Button>
    </HStack>
  );
}
