import { HStack, Text } from "@chakra-ui/react";
import { useDrawer } from "~/hooks/useDrawer";
import { Drawer } from "./ui/drawer";
import { EditModelProviderForm } from "./settings/ModelProviderForm";
import { modelProviders } from "../server/modelProviders/registry";
import { useModelProvidersSettings } from "../hooks/useModelProvidersSettings";

type EditModelProviderDrawerProps = {
  projectId?: string;
  organizationId?: string;
  modelProviderId: string;
};

export const EditModelProviderDrawer = (props: EditModelProviderDrawerProps) => {
    const { projectId, organizationId, modelProviderId } = props;
    const { closeDrawer } = useDrawer();
    const { providers } = useModelProvidersSettings({ projectId });
    
    // Get provider name from the provider ID
    let providerName = "";
    const provider = providers && Object.values(providers).find(p => p.id === modelProviderId);
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
                    <EditModelProviderForm 
                        projectId={projectId}
                        organizationId={organizationId}
                        modelProviderId={modelProviderId}
                    />
                </Drawer.Body>
            </Drawer.Content>

        </Drawer.Root>
    )

}
