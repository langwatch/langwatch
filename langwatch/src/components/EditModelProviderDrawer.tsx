import { HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { useDrawer } from "~/hooks/useDrawer";
import { Drawer } from "./ui/drawer";
import { EditModelProviderForm } from "./settings/ModelProviderForm";
import { modelProviders } from "../server/modelProviders/registry";
import { useModelProvidersSettings } from "../hooks/useModelProvidersSettings";

type EditModelProviderDrawerProps = {
  projectId?: string;
  organizationId?: string;
  modelProviderId?: string;
  providerKey: string;
};

export const EditModelProviderDrawer = (props: EditModelProviderDrawerProps) => {
    const { projectId, organizationId, modelProviderId, providerKey } = props;
    const { closeDrawer } = useDrawer();
    const { providers, isLoading } = useModelProvidersSettings({ projectId });
    
    // Get provider - by id or provider key
    const provider = providers && (
        modelProviderId 
            ? Object.values(providers).find(p => p.id === modelProviderId)
            : providers[providerKey]
    );
    
    // Get provider name for the title
    let providerName = "";
    if (provider) {
        const providerDef = modelProviders[provider.provider as keyof typeof modelProviders];
        providerName = providerDef?.name || provider.provider;
    }
    
    const title = providerName;
    
    return (
        <Drawer.Root
            open={true}
            placement="end"
            size="md"
            onOpenChange={({ open }) => {
                if (!open) {
                closeDrawer();
                }
            }}
            onInteractOutside={closeDrawer}
            >
            <Drawer.Content>
                <Drawer.Header>
                <HStack>
                    <Drawer.CloseTrigger />
                </HStack>
                <HStack>
                    <Text paddingTop={5} fontSize="2xl">
                        {title}
                    </Text>
                </HStack>
                </Drawer.Header>
                <Drawer.Body>
                    {isLoading || !providers ? (
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
    )

}
