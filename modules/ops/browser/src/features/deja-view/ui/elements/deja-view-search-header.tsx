import { Button, HStack, Input } from "@langwatch/design-system/primitives";
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
      minHeight="48px"
      wrap="wrap"
      flexShrink={0}
      paddingY={3}
      width="full"
      gap={3}
      position="sticky"
      top={0}
      zIndex={10}
      background="bg.surface"
    >
      <Input
        size="sm"
        aria-label="Aggregate ID"
        placeholder="Search aggregate ID..."
        value={searchQuery}
        onChange={(e) => onSearchQueryChange(e.target.value)}
        onKeyDown={handleKeyDown}
        flex={1}
      />
      <Input
        size="sm"
        aria-label="Tenant ID"
        placeholder="Tenant ID (optional)"
        value={tenantFilter}
        onChange={(e) => onTenantFilterChange(e.target.value)}
        onKeyDown={handleKeyDown}
        width="200px"
        flexShrink={0}
      />
      <Button
        aria-label="Search aggregates"
        size="sm"
        variant="outline"
        onClick={onSearch}
        loading={isLoading}
        flexShrink={0}
      >
        <Search size={16} /> Search
      </Button>
    </HStack>
  );
}
