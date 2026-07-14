import { Box, Heading, HStack, Spinner, VStack } from "@chakra-ui/react";
import { useDrawer } from "~/hooks/useDrawer";
import {
  findModelProviderById,
  isResolvableProviderId,
  useAllModelProvidersList,
} from "../hooks/useAllModelProvidersList";
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
  // Resolve by id from the flat list — see useAllModelProvidersList for
  // why the collapsed Record is wrong here (#5380). `isAllProvidersLoading`
  // is that hook's spinner signal ("no definitive answer yet"): true while
  // the flat-list query is disabled or in-flight, false once it resolves OR
  // errors — so the gate below keeps spinning until the list is genuinely
  // ready instead of mounting the form off an empty list, but does not spin
  // forever if the query 403s.
  const { providers: allProviders, isLoading: isAllProvidersLoading } =
    useAllModelProvidersList();

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
    const providerDef =
      modelProviders[provider.provider as keyof typeof modelProviders];
    providerName = providerDef?.name || provider.provider;
  }

  const title = providerName;

  // Editing a specific existing row also has to wait on the flat list:
  // rendering the form off the (collapsed-record-only) blank fallback
  // and then resetting once the flat list arrives would wipe whatever
  // the user had already typed.
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
