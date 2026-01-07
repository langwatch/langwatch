
import { HStack, Text } from "@chakra-ui/react";
import { useDrawer } from "~/hooks/useDrawer";
import { Drawer } from "./ui/drawer";
import { AddModelProviderForm, EditModelProviderForm } from "./settings/ModelProviderForm";
import { modelProviders } from "../server/modelProviders/registry";
import { useModelProvidersSettings } from "../hooks/useModelProvidersSettings";

type BaseProps = {
  projectId?: string;
  organizationId?: string;
  currentDefaultModel?: string;
  currentTopicClusteringModel?: string;
  currentEmbeddingsModel?: string;
  onDefaultModelsUpdated?: (models: {
    defaultModel?: string;
    topicClusteringModel?: string;
    embeddingsModel?: string;
  }) => void;
};

type AddOrEditModelProviderDrawerProps = BaseProps & (
  | { mode: "edit"; modelProviderId: string }
  | { mode: "add"; providerKey: string }
);

export const AddOrEditModelProviderDrawer = (props: AddOrEditModelProviderDrawerProps) => {
    const { projectId, organizationId, currentDefaultModel, currentTopicClusteringModel, currentEmbeddingsModel, onDefaultModelsUpdated } = props;
    const { closeDrawer } = useDrawer();
    const { providers } = useModelProvidersSettings({ projectId });
    
    const isAddMode = props.mode === "add";
    
    // Get provider name
    let providerName = "";
    if (isAddMode) {
        const providerDef = modelProviders[props.providerKey as keyof typeof modelProviders];
        providerName = providerDef?.name || props.providerKey;
    } else {
        const provider = providers && Object.values(providers).find(p => p.id === props.modelProviderId);
        if (provider) {
            const providerDef = modelProviders[provider.provider as keyof typeof modelProviders];
            providerName = providerDef?.name || provider.provider;
        }
    }
    
    const title = providerName;
    
    return (
        <Drawer.Root
            open={true}
            placement="end"
            size="lg"
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
                    {props.mode === "add" ? (
                        <AddModelProviderForm 
                            projectId={projectId}
                            organizationId={organizationId}
                            provider={props.providerKey}
                            currentDefaultModel={currentDefaultModel}
                            currentTopicClusteringModel={currentTopicClusteringModel}
                            currentEmbeddingsModel={currentEmbeddingsModel}
                            onDefaultModelsUpdated={onDefaultModelsUpdated}
                        />
                    ) : (
                        <EditModelProviderForm 
                            projectId={projectId}
                            organizationId={organizationId}
                            modelProviderId={props.modelProviderId}
                            currentDefaultModel={currentDefaultModel}
                            currentTopicClusteringModel={currentTopicClusteringModel}
                            currentEmbeddingsModel={currentEmbeddingsModel}
                            onDefaultModelsUpdated={onDefaultModelsUpdated}
                        />
                    )}
                </Drawer.Body>
            </Drawer.Content>

        </Drawer.Root>
    )

}