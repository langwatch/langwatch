
import { HStack, Text } from "@chakra-ui/react";
import { useDrawer } from "~/hooks/useDrawer";
import { Drawer } from "../components/ui/drawer";
import { ModelProviderForm } from "./settings/ModelProviderForm";

type AddOrEditModelProviderDrawerProps = { 
    modelProviderId?: string | undefined,
    projectId?: string | undefined
}
export const AddOrEditModelProviderDrawer = ({
    modelProviderId,
    projectId
}: AddOrEditModelProviderDrawerProps) => {
    const { closeDrawer } = useDrawer();
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
                        Model Provider
                    </Text>
                </HStack>
                </Drawer.Header>
                <Drawer.Body>
                    <ModelProviderForm 
                        projectId={projectId}
                        modelProviderId={modelProviderId}
                    />
                </Drawer.Body>
            </Drawer.Content>

        </Drawer.Root>
    )

}