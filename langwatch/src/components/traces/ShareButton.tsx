import { Button, HStack, Text, VStack, useDisclosure } from "@chakra-ui/react";
import { Popover } from "../ui/popover";
import { toaster } from "../ui/toaster";
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
  const { open, onOpen, onClose, setOpen } = useDisclosure();
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
    <Popover.Root
      open={open}
      onOpenChange={({ open }) => {
        if (!open) {
          onClose_();
        } else {
          onOpen();
        }
      }}
      positioning={{ placement: "bottom-end" }}
    >
      <Popover.Trigger>
        <Button colorPalette="black" variant="outline">
          {shareState.data?.id ? <Globe size={16} /> : <Share size={16} />}
          {shareState.data?.id ? "Public" : "Share"}
        </Button>
      </Popover.Trigger>
      <Popover.Content fontSize="16px" minWidth="400px">
        <Popover.Arrow />
        <Popover.Header>
          <Popover.Title fontWeight={600}>Share Trace</Popover.Title>
        </Popover.Header>
        <Popover.Body>
          <VStack align="start" fontWeight="normal" gap={4}>
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
                      colorPalette="gray"
                      loading={
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
                                    toaster.create({
                                      title: "Shared link removed",
                                      description: "Trace is no longer public",
                                      type: "success",
                                      meta: {
                                        closable: true,
                                      },
                                      placement: "top-end",
                                    });
                                  }
                                })
                                .catch(() => {
                                  toaster.create({
                                    title: "Failed to fetch trace shared state",
                                    description:
                                      "Something went wrong, please try again.",
                                    type: "error",
                                    meta: {
                                      closable: true,
                                    },
                                    placement: "top-end",
                                  });
                                });
                            },
                            onError: () => {
                              setDisableClose(false);
                              toaster.create({
                                title: "Failed to unshare trace",
                                description:
                                  "Something went wrong, please try again.",
                                type: "error",
                                meta: {
                                  closable: true,
                                },
                                placement: "top-end",
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
                  colorPalette="orange"
                  loading={
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
                          toaster.create({
                            title: "Failed to share trace",
                            description:
                              "Something went wrong, please try again.",
                            type: "error",
                            meta: {
                              closable: true,
                            },
                            placement: "top-end",
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
        </Popover.Body>
      </Popover.Content>
    </Popover.Root>
  );
}
