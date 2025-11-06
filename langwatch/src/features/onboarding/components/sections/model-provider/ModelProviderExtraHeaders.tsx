import React from "react";
import {
  Button,
  Field,
  Grid,
  GridItem,
  HStack,
  IconButton,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Plus, Trash2 } from "lucide-react";
import type { ExtraHeader } from "../../../../../hooks/useModelProviderForm";
import { InputWithPrefix } from "../shared/InputWithPrefix";

interface ModelProviderExtraHeadersProps {
  headers: ExtraHeader[];
  onHeaderKeyChange: (index: number, value: string) => void;
  onHeaderValueChange: (index: number, value: string) => void;
  onRemoveHeader: (index: number) => void;
  onAddHeader: () => void;
}

export const ModelProviderExtraHeaders: React.FC<
  ModelProviderExtraHeadersProps
> = ({
  headers,
  onHeaderKeyChange,
  onHeaderValueChange,
  onRemoveHeader,
  onAddHeader,
}: ModelProviderExtraHeadersProps) => (
  <VStack align="stretch" gap={2}>
    <Field.Root>
      <Field.Label>
        <Text fontSize="sm" fontWeight="medium">
          Extra Headers
        </Text>
      </Field.Label>
      <Grid templateColumns="auto auto" gap={3} rowGap={2}>
        {headers.map((header, index) => (
          <React.Fragment key={`${header.key}-${index}`}>
            <GridItem>
              <InputWithPrefix
                placeholder="Header name"
                value={header.key}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                  onHeaderKeyChange(index, event.target.value)
                }
                ariaLabel="Header name"
              />
            </GridItem>
            <GridItem>
              <HStack gap={1}>
                <InputWithPrefix
                  placeholder="Header value"
                  value={header.value}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                    onHeaderValueChange(index, event.target.value)
                  }
                  showVisibilityToggle
                  ariaLabel="Header value"
                />
                <IconButton
                  size="sm"
                  variant="ghost"
                  colorPalette="red"
                  onClick={() => onRemoveHeader(index)}
                  aria-label={`Remove header ${header.key || index + 1}`}
                >
                  <Trash2 />
                </IconButton>
              </HStack>
            </GridItem>
          </React.Fragment>
        ))}
      </Grid>
      <HStack justify="end">
        <Button
          size="xs"
          variant="surface"
          bg="bg.subtle/10"
          backdropBlur="md"
          w="full"
          onClick={onAddHeader}
        >
          <Plus /> Add Header
        </Button>
      </HStack>
    </Field.Root>
  </VStack>
);
