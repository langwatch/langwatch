import {
  Box,
  Button,
  HStack,
  Input,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Plus } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Dialog } from "./dialog";

// Context for sharing state between compound components
interface PickerContextValue {
  searchValue: string;
  setSearchValue: (value: string) => void;
  onClose: () => void;
}

const PickerContext = createContext<PickerContextValue | null>(null);

function usePickerContext() {
  const context = useContext(PickerContext);
  if (!context) {
    throw new Error(
      "SearchablePickerDialog components must be used within SearchablePickerDialog.Root",
    );
  }
  return context;
}

// ============================================================================
// Root Component
// ============================================================================

interface RootProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  maxWidth?: string;
}

function Root({
  open,
  onClose,
  title,
  children,
  maxWidth = "500px",
}: RootProps) {
  const [searchValue, setSearchValue] = useState("");

  // Clear search when dialog closes
  useEffect(() => {
    if (!open) {
      setSearchValue("");
    }
  }, [open]);

  return (
    <PickerContext.Provider value={{ searchValue, setSearchValue, onClose }}>
      <Dialog.Root open={open} onOpenChange={(e) => !e.open && onClose()}>
        <Dialog.Content maxWidth={maxWidth}>
          <Dialog.Header paddingInline={4}>
            <Dialog.Title>{title}</Dialog.Title>
          </Dialog.Header>
          <Dialog.CloseTrigger />
          {children}
        </Dialog.Content>
      </Dialog.Root>
    </PickerContext.Provider>
  );
}

// ============================================================================
// Body Component - Handles loading/empty/content states
// ============================================================================

interface BodyProps {
  isLoading?: boolean;
  isEmpty?: boolean;
  emptyState?: ReactNode;
  children: ReactNode;
}

function Body({ isLoading, isEmpty, emptyState, children }: BodyProps) {
  if (isLoading) {
    return (
      <Dialog.Body paddingX={0} paddingBottom={0}>
        <VStack padding={8}>
          <Spinner />
        </VStack>
      </Dialog.Body>
    );
  }

  if (isEmpty && emptyState) {
    return (
      <Dialog.Body paddingX={0} paddingBottom={0}>
        {emptyState}
      </Dialog.Body>
    );
  }

  return (
    <Dialog.Body paddingX={0} paddingBottom={0}>
      <VStack gap={0} align="stretch">
        {children}
      </VStack>
    </Dialog.Body>
  );
}

// ============================================================================
// Search Input Component
// ============================================================================

interface SearchInputProps {
  placeholder?: string;
}

function SearchInput({ placeholder = "Search..." }: SearchInputProps) {
  const { searchValue, setSearchValue } = usePickerContext();
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus search input when dialog opens
  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  return (
    <Box paddingX={4} paddingBottom={3}>
      <Input
        ref={inputRef}
        size="sm"
        placeholder={placeholder}
        value={searchValue}
        onChange={(e) => setSearchValue(e.target.value)}
        data-testid="picker-search-input"
      />
    </Box>
  );
}

// ============================================================================
// Scrollable Content Container
// ============================================================================

interface ScrollableContentProps {
  children: ReactNode;
  maxHeight?: string;
}

function ScrollableContent({
  children,
  maxHeight = "400px",
}: ScrollableContentProps) {
  return (
    <Box maxHeight={maxHeight} overflowY="auto">
      {children}
    </Box>
  );
}

// ============================================================================
// Section Component
// ============================================================================

interface SectionProps {
  title: string;
  children: ReactNode;
}

function Section({ title, children }: SectionProps) {
  return (
    <Box>
      <Text
        fontSize="xs"
        fontWeight="bold"
        textTransform="uppercase"
        color="gray.500"
        paddingX={4}
        paddingY={2}
        bg="gray.50"
      >
        {title}
      </Text>
      {children}
    </Box>
  );
}

// ============================================================================
// Item Row Component
// ============================================================================

interface ItemRowProps {
  icon: ReactNode;
  name: string;
  secondaryText?: string;
  onClick: () => void;
  testId?: string;
}

function ItemRow({ icon, name, secondaryText, onClick, testId }: ItemRowProps) {
  const { onClose } = usePickerContext();

  const handleClick = () => {
    onClick();
    onClose();
  };

  return (
    <HStack
      paddingX={4}
      paddingY={3}
      cursor="pointer"
      _hover={{ bg: "gray.50" }}
      onClick={handleClick}
      gap={3}
      data-testid={testId}
    >
      <Box color="gray.500">{icon}</Box>
      <Text fontSize="sm" flex={1}>
        {name}
      </Text>
      {secondaryText && (
        <Text fontSize="xs" color="gray.400">
          {secondaryText}
        </Text>
      )}
    </HStack>
  );
}

// ============================================================================
// No Results Component
// ============================================================================

interface NoResultsProps {
  message?: string;
}

function NoResults({ message = "No results found" }: NoResultsProps) {
  return (
    <Text fontSize="sm" color="gray.400" paddingX={4} paddingY={3}>
      {message}
    </Text>
  );
}

// ============================================================================
// Empty State Component
// ============================================================================

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
}

function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  const { onClose } = usePickerContext();

  const handleAction = () => {
    onAction();
    onClose();
  };

  return (
    <VStack padding={8} gap={4}>
      <Box padding={4} borderRadius="full" backgroundColor="gray.100">
        {icon}
      </Box>
      <Text fontWeight="medium" fontSize="lg">
        {title}
      </Text>
      <Text color="gray.500" textAlign="center">
        {description}
      </Text>
      <Button
        colorPalette="blue"
        onClick={handleAction}
        marginTop={2}
        data-testid="picker-empty-state-action"
      >
        <Plus size={14} />
        {actionLabel}
      </Button>
    </VStack>
  );
}

// ============================================================================
// Create Button Component (at bottom of list)
// ============================================================================

interface CreateButtonProps {
  label: string;
  onClick: () => void;
}

function CreateButton({ label, onClick }: CreateButtonProps) {
  const { onClose } = usePickerContext();

  const handleClick = () => {
    onClick();
    onClose();
  };

  return (
    <Box borderTopWidth="1px" borderColor="gray.200" paddingX={4} paddingY={3}>
      <Button
        variant="ghost"
        size="sm"
        colorPalette="blue"
        onClick={handleClick}
        width="full"
        justifyContent="flex-start"
        data-testid="picker-create-button"
      >
        <Plus size={14} />
        {label}
      </Button>
    </Box>
  );
}

// ============================================================================
// Footer Component
// ============================================================================

interface FooterProps {
  children?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
}

function Footer({ children, actionLabel, onAction }: FooterProps) {
  const { onClose } = usePickerContext();

  const handleAction = () => {
    onAction?.();
    onClose();
  };

  return (
    <Dialog.Footer borderTopWidth="1px" paddingInline={4}>
      {children ?? (
        <HStack width="100%" justifyContent="space-between">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          {actionLabel && onAction && (
            <Button
              colorPalette="blue"
              onClick={handleAction}
              data-testid="picker-create-button"
            >
              <Plus size={14} />
              {actionLabel}
            </Button>
          )}
        </HStack>
      )}
    </Dialog.Footer>
  );
}

// ============================================================================
// Hook for filtering items
// ============================================================================

function usePickerSearch() {
  const { searchValue } = usePickerContext();
  return { searchValue };
}

// ============================================================================
// Export compound component
// ============================================================================

export const SearchablePickerDialog = {
  Root,
  Body,
  SearchInput,
  ScrollableContent,
  Section,
  ItemRow,
  NoResults,
  EmptyState,
  CreateButton,
  Footer,
  usePickerSearch,
};
