import {
  Button,
  HStack,
  Popover,
  PopoverArrow,
  PopoverBody,
  PopoverContent,
  PopoverHeader,
  PopoverTrigger,
  Text,
  VStack,
  useDisclosure,
  useToast,
} from "@chakra-ui/react";
import { PublicShareResourceTypes, type Project } from "@prisma/client";
import { useCallback, useState } from "react";
import { Globe, Share } from "react-feather";
import { CopyInput } from "../CopyInput";
import { api } from "../../utils/api";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { TeamRoleGroup } from "../../server/api/permission";

export function ShareButton({
  project,
  traceId,
}: {
  project: Project;
  traceId: string;
}) {
  const { hasTeamPermission } = useOrganizationTeamProject();
  const { isOpen, onOpen, onClose } = useDisclosure();
  const shareState = api.share.getSharedState.useQuery(
    {
      projectId: project.id,
      resourceType: PublicShareResourceTypes.TRACE,
      resourceId: traceId,
    },
    {
      refetchOnWindowFocus: false,
      refetchOnMount: false,
    }
  );
  const shareItemMutation = api.share.shareItem.useMutation();
  const unshareItemMutation = api.share.unshareItem.useMutation();
  const toast = useToast();
  const [disableClose, setDisableClose] = useState(false); // bugfix for modal closing when starting the mutation
  const hasSharePermission = hasTeamPermission(TeamRoleGroup.MESSAGES_SHARE);

  const onClose_ = useCallback(() => {
    if (disableClose) return;
    onClose();
  }, [disableClose, onClose]);

  if (!hasSharePermission && !shareState.data?.id) {
    return null;
  }

  return (
    <Popover
      isOpen={isOpen}
      onOpen={onOpen}
      onClose={onClose_}
      placement="bottom-end"
    >
      <PopoverTrigger>
        <Button
          colorScheme="black"
          variant="outline"
          leftIcon={
            shareState.data?.id ? <Globe size={16} /> : <Share size={16} />
          }
        >
          {shareState.data?.id ? "Public" : "Share"}
        </Button>
      </PopoverTrigger>
      <PopoverContent fontSize={16} minWidth="400px">
        <PopoverArrow />
        <PopoverHeader fontWeight={600}>Share Trace</PopoverHeader>
        <PopoverBody>
          <VStack align="start" fontWeight="normal" spacing={4}>
            {shareState.data?.id ? (
              <>
                <Text>
                  Anyone with the link below can view this trace, the
                  evaluations and the annotations associated with it
                </Text>
                <HStack width="full">
                  <CopyInput
                    value={`${window.location.origin}/share/${shareState.data?.id}`}
                    label="Public Trace URL"
                  />
                  {hasSharePermission && (
                    <Button
                      colorScheme="gray"
                      isLoading={
                        unshareItemMutation.isLoading || shareState.isRefetching
                      }
                      onClick={() => {
                        setDisableClose(true);

                        unshareItemMutation.mutate(
                          {
                            projectId: project.id,
                            resourceType: PublicShareResourceTypes.TRACE,
                            resourceId: traceId,
                          },
                          {
                            onSuccess: () => {
                              setDisableClose(false);
                              onClose();
                              shareState
                                .refetch()
                                .then((shareState) => {
                                  if (!shareState.data?.id) {
                                    toast({
                                      title: "Shared link removed",
                                      description: "Trace is no longer public",
                                      status: "success",
                                      duration: 5000,
                                      isClosable: true,
                                    });
                                  }
                                })
                                .catch(() => {
                                  toast({
                                    title: "Failed to fetch trace shared state",
                                    description:
                                      "Something went wrong, please try again.",
                                    status: "error",
                                    duration: 5000,
                                    isClosable: true,
                                  });
                                });
                            },
                            onError: () => {
                              setDisableClose(false);
                              toast({
                                title: "Failed to unshare trace",
                                description:
                                  "Something went wrong, please try again.",
                                status: "error",
                                duration: 5000,
                                isClosable: true,
                              });
                            },
                          }
                        );
                      }}
                    >
                      Unshare
                    </Button>
                  )}
                </HStack>
              </>
            ) : (
              <>
                <Text>Are you sure you want to share this trace publicly?</Text>
                <Button
                  colorScheme="orange"
                  isLoading={
                    shareItemMutation.isLoading || shareState.isRefetching
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    setDisableClose(true);

                    shareItemMutation.mutate(
                      {
                        projectId: project.id,
                        resourceType: PublicShareResourceTypes.TRACE,
                        resourceId: traceId,
                      },
                      {
                        onSuccess: () => {
                          setDisableClose(false);
                          void shareState.refetch();
                        },
                        onError: () => {
                          setDisableClose(false);
                          toast({
                            title: "Failed to share trace",
                            description:
                              "Something went wrong, please try again.",
                            status: "error",
                            duration: 5000,
                            isClosable: true,
                          });
                        },
                      }
                    );
                  }}
                >
                  Share
                </Button>
              </>
            )}
          </VStack>
        </PopoverBody>
      </PopoverContent>
    </Popover>
  );
}
