import {
  Button,
  Grid,
  GridItem,
  HStack,
  Input,
  VStack,
} from "@chakra-ui/react";
import { Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import React from "react";
import type {
  ExtraHeader,
  UseModelProviderFormActions,
  UseModelProviderFormState,
} from "../../hooks/useModelProviderForm";
import type { MaybeStoredModelProvider } from "../../server/modelProviders/registry";
import { SmallLabel } from "../SmallLabel";

/**
 * Renders a section for adding custom HTTP headers to API requests.
 * Only visible for Azure and Custom providers that support additional headers.
 * Provides controls to add/remove headers and toggle visibility (concealment) of header values.
 * @param state - Form state containing extra headers configuration
 * @param actions - Form actions for managing extra headers
 * @param provider - The model provider configuration
 */
export const ExtraHeadersSection = ({
  state,
  actions,
  provider,
}: {
  state: UseModelProviderFormState;
  actions: UseModelProviderFormActions;
  provider: MaybeStoredModelProvider;
}) => {
  if (provider.provider !== "azure" && provider.provider !== "custom") {
    return null;
  }

  return (
    <VStack width="full" align="start" paddingTop={4}>
      {state.extraHeaders.length > 0 && (
        <Grid
          templateColumns="auto auto auto auto"
          gap={4}
          rowGap={2}
          width="full"
        >
          <GridItem color="gray.500" colSpan={4}>
            <SmallLabel>Extra Headers</SmallLabel>
          </GridItem>
          {state.extraHeaders.map((h: ExtraHeader, index: number) => (
            <React.Fragment key={index}>
              <GridItem>
                <Input
                  value={h.key}
                  onChange={(e) =>
                    actions.setExtraHeaderKey(index, e.target.value)
                  }
                  placeholder="Header name"
                  autoComplete="off"
                  width="full"
                />
              </GridItem>
              <GridItem>
                <Input
                  value={h.value}
                  onChange={(e) =>
                    actions.setExtraHeaderValue(index, e.target.value)
                  }
                  type={h.concealed ? "password" : "text"}
                  placeholder="Header value"
                  autoComplete="off"
                  width="full"
                />
              </GridItem>
              <GridItem>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => actions.toggleExtraHeaderConcealed(index)}
                >
                  {h.concealed ? <EyeOff size={16} /> : <Eye size={16} />}
                </Button>
              </GridItem>
              <GridItem>
                <Button
                  size="sm"
                  variant="ghost"
                  colorPalette="red"
                  onClick={() => actions.removeExtraHeader(index)}
                >
                  <Trash2 size={16} />
                </Button>
              </GridItem>
            </React.Fragment>
          ))}
        </Grid>
      )}

      <HStack width="full" justify="end">
        <Button size="xs" variant="outline" onClick={actions.addExtraHeader}>
          <Plus size={16} />
          Add Header
        </Button>
      </HStack>
    </VStack>
  );
};
