import { Box, Heading, HStack, Spinner, VStack } from "@chakra-ui/react";
import { useDrawer } from "~/hooks/useDrawer";
import { useAllModelProvidersList } from "../hooks/useAllModelProvidersList";
import { useModelProvidersSettings } from "../hooks/useModelProvidersSettings";
import { modelProviderIcons } from "../server/modelProviders/iconsMap";
import { modelProviders } from "../server/modelProviders/registry";
import { EditModelProviderForm } from "./settings/ModelProviderForm";
import { Drawer } from "./ui/drawer";

type EditModelProviderDrawerProps = {
  projectId?: string;
  organizationId?: string;
  modelProviderId?: string;
  providerKey: string;
};

export const EditModelProviderDrawer = (
  props: EditModelProviderDrawerProps,
) => {
  const { projectId, organizationId, modelProviderId, providerKey } = props;
  const { closeDrawer } = useDrawer();
  const { providers, isLoading } = useModelProvidersSettings({ projectId });
  // The row this drawer is titled for must come from the same
  // uncollapsed list `EditModelProviderForm` resolves its edit target
  // from — the settings table passes ids from that flat list, and the
  // `providers` Record above dedupes by provider type, so an id lookup
  // against it can silently miss a same-type row (#5380).
  const { providers: allProviders, isLoading: isAllProvidersLoading } =
    useAllModelProvidersList();

  // Get provider - by id (flat list) or provider key (collapsed record;
  // correct there since it's asking "whichever row owns this provider
  // type right now", not "this specific row").
  const provider = modelProviderId
    ? allProviders.find((p) => p.id === modelProviderId)
    : providers?.[providerKey];

  // Get provider name for the title
  let providerName = "";
  if (provider) {
    const providerDef =
      modelProviders[provider.provider as keyof typeof modelProviders];
    providerName = providerDef?.name || provider.provider;
  }

  const title = providerName;

  // Editing a specific existing row also has to wait on the flat list:
  // rendering the form off the (collapsed-record-only) blank fallback
  // and then resetting once the flat list arrives would wipe whatever
  // the user had already typed.
  const isEditingSpecificRow = !!modelProviderId && modelProviderId !== "new";
  const isFormDataLoading =
    isLoading || !providers || (isEditingSpecificRow && isAllProvidersLoading);

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
      <Drawer.Content bg="bg">
        <Drawer.Header>
          <HStack>
            <Drawer.CloseTrigger />
          </HStack>
          <HStack gap={3}>
            {provider && (
              <Box width="28px" height="28px">
                {
                  modelProviderIcons[
                    provider.provider as keyof typeof modelProviderIcons
                  ]
                }
              </Box>
            )}
            <Heading as="h2">{title}</Heading>
          </HStack>
        </Drawer.Header>
        <Drawer.Body>
          {isFormDataLoading ? (
            <VStack height="200px" justify="center">
              <Spinner />
            </VStack>
          ) : (
            <EditModelProviderForm
              projectId={projectId}
              organizationId={organizationId}
              modelProviderId={modelProviderId}
              providerKey={providerKey}
            />
          )}
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
};
