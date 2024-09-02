import {
  Alert,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Button,
  CloseButton,
  Text,
  useToast,
  VStack,
} from "@chakra-ui/react";
import { useCallback } from "react";
import type { BaseComponent } from "../types/dsl";
import { useWorkflowStore } from "./useWorkflowStore";

export const useAlertOnComponent = () => {
  const toast = useToast();

  const { setSelectedNode } = useWorkflowStore((state) => ({
    setSelectedNode: state.setSelectedNode,
  }));

  return useCallback(
    ({
      componentId,
      execution_state,
    }: {
      componentId: string;
      execution_state: BaseComponent["execution_state"];
    }) => {
      toast({
        title: "Error",
        description: execution_state?.error,
        render: ({ onClose }) => {
          return (
            <Alert
              status="error"
              variant="solid"
              alignItems="start"
              display="flex"
              flexDirection="row"
            >
              <AlertIcon />
              <VStack align="start" spacing={0} width="full">
                <AlertTitle fontSize="md">Error</AlertTitle>
                <AlertDescription>
                  <VStack align="start">
                    <Text>{execution_state?.error}</Text>
                    <Button
                      colorScheme="white"
                      variant="link"
                      size="sm"
                      onClick={() => {
                        setSelectedNode(componentId);
                        onClose();
                      }}
                    >
                      Go to component
                    </Button>
                  </VStack>
                </AlertDescription>
              </VStack>
              <CloseButton
                alignSelf="flex-start"
                position="relative"
                right={-1}
                top={-1}
                onClick={onClose}
              />
            </Alert>
          );
        },
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    },
    [setSelectedNode, toast]
  );
};
