import { useDrawer } from "@langwatch/browser-host/drawer";
import { Drawer } from "@langwatch/design-system/drawer";
import { Button, HStack } from "@langwatch/design-system/primitives";
import { isProviderKey, ProviderIconGlyph } from "@langwatch/design-system/provider-icons";
import { SkeletonRows } from "@langwatch/design-system/skeletons";
import { useModelProvidersSettings } from "@langwatch/model-provider-client";
import { modelProviders } from "@langwatch/model-provider-contract";
import { useState } from "react";

import {
  findModelProviderById,
  isResolvableProviderId,
  useAllModelProvidersList,
} from "../../behavior/use-all-model-providers-list.ts";
import { EditModelProviderForm, type ModelProviderSaveState } from "./model-provider-form.tsx";

type EditModelProviderDrawerProps = {
  projectId?: string;
  organizationId?: string;
  modelProviderId?: string;
  providerKey: string;
};

export const EditModelProviderDrawer = (props: EditModelProviderDrawerProps) => {
  const { projectId, organizationId, modelProviderId, providerKey } = props;
  const { closeDrawer } = useDrawer();
  const [saveState, setSaveState] = useState<ModelProviderSaveState>({
    busy: false,
    label: "Save",
    canSave: true,
  });
  const { providers, isLoading } = useModelProvidersSettings({ projectId });
  // Resolve by id from the flat list — see useAllModelProvidersList for
  // why the collapsed Record is wrong here (#5380). `isAllProvidersLoading`
  // is true while the flat-list query is disabled/in-flight, false once it
  // resolves OR errors, so a 403 doesn't spin the gate forever.
  const { providers: allProviders, isLoading: isAllProvidersLoading } = useAllModelProvidersList();

  // A specific row is being edited only when modelProviderId is a real
  // id — not the Add-flow sentinel "new" and not absent.
  const isEditingSpecificRow = isResolvableProviderId(modelProviderId);

  // Title/icon source: the specific row by id (shared resolver) when
  // editing one, else the collapsed record's current winner for this
  // provider type — right there, since "new"/no-id means "whichever row
  // owns this provider type right now", not "this specific row".
  const provider = isEditingSpecificRow
    ? findModelProviderById({ providers: allProviders, modelProviderId })
    : providers?.[providerKey];

  // Get provider name for the title
  let providerName = "";
  if (provider) {
    const providerDef = modelProviders[provider.provider as keyof typeof modelProviders];
    providerName = providerDef?.name || provider.provider;
  }

  const title = providerName;

  // Waits on the flat list, not just the collapsed record: resetting the form once
  // it arrives would wipe what the user typed, and the collapsed record never arrives
  // without a project, so waiting on it alone would spin forever.
  const isCollapsedRecordPending = !!projectId && (isLoading || !providers);
  const isFormDataLoading =
    isCollapsedRecordPending || (isEditingSpecificRow && isAllProvidersLoading);

  return (
    <Drawer.Root
      open={true}
      placement="end"
      size="xl"
      onOpenChange={({ open }) => {
        if (!open) {
          closeDrawer();
        }
      }}
      modal={false}
    >
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.CloseTrigger />
          <HStack gap={3}>
            {provider && isProviderKey(provider.provider) && (
              <ProviderIconGlyph provider={provider.provider} size="28px" />
            )}
            <Drawer.Title>{title}</Drawer.Title>
          </HStack>
        </Drawer.Header>
        <Drawer.Body>
          {isFormDataLoading ? (
            <SkeletonRows rows={4} />
          ) : (
            <EditModelProviderForm
              projectId={projectId}
              organizationId={organizationId}
              modelProviderId={modelProviderId}
              providerKey={providerKey}
              formId="model-provider-form"
              onSaveStateChange={setSaveState}
            />
          )}
        </Drawer.Body>
        {!isFormDataLoading && (
          <Drawer.Actions
            onCancel={closeDrawer}
            busy={saveState.busy}
            primary={
              <Button
                colorPalette="orange"
                type="submit"
                form="model-provider-form"
                loading={saveState.busy}
                disabled={!saveState.canSave}
                data-testid="model-provider-save"
              >
                {saveState.label}
              </Button>
            }
          />
        )}
      </Drawer.Content>
    </Drawer.Root>
  );
};
