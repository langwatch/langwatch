import {
  Button,
  Field,
  HStack,
  Input,
  NativeSelect,
  Stack,
  Text,
  useDisclosure,
  VStack,
} from "@chakra-ui/react";
import { Bell, Check, Trash } from "lucide-react";
import { type UseFormReturn, useForm } from "react-hook-form";
import { useMemo, useState, useEffect } from "react";
import { Drawer, DrawerFooter } from "../ui/drawer";
import { Popover } from "../ui/popover";
import { Radio, RadioGroup } from "../ui/radio";
import { Tooltip } from "../ui/tooltip";
import { useDrawer } from "../../hooks/useDrawer";
import { useFilterParams } from "../../hooks/useFilterParams";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { usePublicEnv } from "../../hooks/usePublicEnv";
import { api } from "../../utils/api";
import { toaster } from "../ui/toaster";
import type { CustomGraphFormData } from "../../pages/[project]/analytics/custom/index";
import {
  customGraphFormToCustomGraphInput,
  customGraphInputToFormData,
} from "../../pages/[project]/analytics/custom/index";
import type { CustomGraphInput } from "./CustomGraph";

interface AlertDrawerProps {
  form?: UseFormReturn<CustomGraphFormData>;
  graphId?: string;
}

/**
 * AlertDrawer component for configuring custom graph alerts
 * Allows users to set up email or Slack notifications when metrics cross thresholds
 */
export function AlertDrawer({ form: providedForm, graphId }: AlertDrawerProps) {
  const { closeDrawer } = useDrawer();
  const { team, organization, project } = useOrganizationTeamProject();
  const { filterParams } = useFilterParams();
  const publicEnv = usePublicEnv();
  const hasEmailProvider = publicEnv.data?.HAS_EMAIL_PROVIDER_KEY;
  const { open, onOpen, onClose } = useDisclosure();

  // Fetch graph data if graphId is provided but form is not
  const graphQuery = api.graphs.getById.useQuery(
    {
      projectId: project?.id ?? "",
      id: graphId ?? "",
    },
    {
      enabled: !!graphId && !providedForm && !!project?.id,
    },
  );

  // Create internal form from graph data if no form was provided
  const internalForm = useForm<CustomGraphFormData>();

  // Use provided form or internal form
  const form = providedForm || internalForm;

  // Update internal form when graph data loads
  useEffect(() => {
    if (!providedForm && graphQuery.data) {
      const formData = customGraphInputToFormData(
        graphQuery.data.graph as CustomGraphInput,
      );
      internalForm.reset({
        ...formData,
        title: graphQuery.data.name,
        alert: graphQuery.data.alert as CustomGraphFormData["alert"],
      });
    }
  }, [graphQuery.data, providedForm]);

  const updateGraphById = api.graphs.updateById.useMutation();
  const trpc = api.useContext();

  const teamSlug = team?.slug;
  const teamWithMembers = api.team.getTeamWithMembers.useQuery(
    {
      slug: teamSlug ?? "",
      organizationId: organization?.id ?? "",
    },
    { enabled: typeof teamSlug === "string" && !!organization?.id },
  );

  const alertEnabled = form?.watch("alert.enabled");
  const series = form?.watch("series") ?? [];

  // Generate series keys in the format used by the graph data (index/key/aggregation)
  // Memoize to prevent recalculations that could cause re-renders
  const seriesKeys = useMemo(() => {
    const currentSeries = form?.watch("series") ?? [];
    return currentSeries.map((s, index) => {
      const keyPart = s.key || s.metric;
      const aggregationPart = s.aggregation || "count";
      const generatedKey = `${index}/${keyPart}/${aggregationPart}`;
      // Use series name if available, otherwise show a readable version of the key
      const label =
        s.name || `Series ${index + 1}: ${keyPart} (${aggregationPart})`;
      return {
        key: generatedKey,
        label: label,
        rawKey: generatedKey, // Keep the raw key for debugging
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(series)]);

  const selectedSeriesName =
    form?.watch("alert.seriesName") ?? seriesKeys[0]?.key ?? "";

  // Track action locally for immediate UI updates
  const [alertAction, setAlertAction] = useState<
    "SEND_EMAIL" | "SEND_SLACK_MESSAGE"
  >(form?.watch("alert.action") ?? "SEND_SLACK_MESSAGE");

  // Email MultiSelect - inline like TriggerDrawer
  const formMembers = form?.watch("alert.actionParams.members") ?? [];
  const [selectedMembers, setSelectedMembers] = useState<string[]>(formMembers);

  // Update local state when form data changes (e.g., after loading from graph query)
  useEffect(() => {
    const action = form?.watch("alert.action");
    if (action) {
      setAlertAction(action);
    }
    const members = form?.watch("alert.actionParams.members");
    if (members) {
      setSelectedMembers(members);
    }
  }, [graphQuery.data]);

  // Initialize alert fields with default values if not set
  useEffect(() => {
    if (!form) return;

    // Only set defaults if there's no existing alert data
    const currentAlert = form.watch("alert");
    if (!currentAlert || !currentAlert.operator) {
      form.setValue("alert.operator", "gt");
    }
    if (!currentAlert || !currentAlert.timePeriod) {
      form.setValue("alert.timePeriod", 60);
    }
    if (!currentAlert || !currentAlert.type) {
      form.setValue("alert.type", "WARNING");
    }
    if (!currentAlert || !currentAlert.action) {
      form.setValue("alert.action", "SEND_SLACK_MESSAGE");
    }
  }, [form]);

  const handlePopoverChange = ({ open: isOpen }: { open: boolean }) => {
    if (isOpen) {
      onOpen();
    } else {
      form?.setValue("alert.actionParams.members", selectedMembers);
      onClose();
    }
  };

  const MultiSelect = () => (
    <VStack width="full" align="start" marginLeft={7}>
      <Popover.Root
        positioning={{ placement: "bottom" }}
        open={open}
        onOpenChange={handlePopoverChange}
      >
        <Popover.Trigger width="calc(100% - 28px)">
          <Field.Root width="100%">
            <Input
              placeholder="Select email/s"
              value={selectedMembers.join(", ")}
              readOnly
              width="100%"
            />
          </Field.Root>
        </Popover.Trigger>
        <Popover.Content marginTop="-8px">
          <Popover.CloseTrigger onClick={onClose} zIndex={1000} />
          <Popover.Body>
            <VStack width="full" align="start">
              {teamWithMembers.data?.members.map((member) => {
                const email = member.user.email ?? "";
                return (
                  <HStack
                    key={member.user.id}
                    cursor="pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (selectedMembers.includes(email)) {
                        setSelectedMembers(
                          selectedMembers.filter((m) => m !== email),
                        );
                      } else {
                        setSelectedMembers([...selectedMembers, email]);
                      }
                    }}
                  >
                    <Check
                      size={18}
                      color={selectedMembers.includes(email) ? "green" : "gray"}
                    />
                    <Text>{email}</Text>
                  </HStack>
                );
              })}
            </VStack>
          </Popover.Body>
        </Popover.Content>
      </Popover.Root>
    </VStack>
  );

  const handleSave = () => {
    if (!form || !graphId || !project) return;

    form.setValue("alert.enabled", true);
    // Default to first series if not set
    if (!form.watch("alert.seriesName") && seriesKeys[0]?.key) {
      form.setValue("alert.seriesName", seriesKeys[0].key);
    }

    // Save the graph with the alert configuration
    const graphName = form.getValues("title");
    const graphJson = customGraphFormToCustomGraphInput(form.getValues());
    const formData = form.getValues();

    // Get the series label for the alert name
    const selectedSeries = seriesKeys.find(
      (s) => s.key === formData.alert?.seriesName,
    );
    const seriesLabel = selectedSeries?.label ?? graphName ?? "Alert";

    // Restructure alert data to include seriesName in actionParams for backend
    const alertData = formData.alert
      ? {
          ...formData.alert,
          actionParams: {
            ...formData.alert.actionParams,
            seriesName: formData.alert.seriesName,
          },
        }
      : undefined;

    updateGraphById.mutate(
      {
        projectId: project.id,
        name: graphName ?? "",
        graphId: graphId,
        graph: JSON.stringify(graphJson),
        filterParams: filterParams,
        alert: alertData,
        alertName: seriesLabel,
      },
      {
        onSuccess: () => {
          void trpc.graphs.getById.invalidate();
          void trpc.graphs.getAll.invalidate();
          toaster.create({
            title: "Alert saved",
            type: "success",
          });
          closeDrawer();
        },
        onError: () => {
          toaster.create({
            title: "Error saving alert",
            type: "error",
          });
        },
      },
    );
  };

  const handleRemoveAlert = () => {
    if (!form || !graphId || !project) return;

    form.setValue("alert.enabled", false);
    form.setValue("alert.threshold", 0);
    form.setValue("alert.seriesName", "");
    form.setValue("alert.actionParams.members", []);
    form.setValue("alert.actionParams.slackWebhook", "");

    // Save the graph without the alert
    const graphName = form.getValues("title");
    const graphJson = customGraphFormToCustomGraphInput(form.getValues());
    const formData = form.getValues();

    updateGraphById.mutate(
      {
        projectId: project.id,
        name: graphName ?? "",
        graphId: graphId,
        graph: JSON.stringify(graphJson),
        filterParams: filterParams,
        alert: formData.alert,
      },
      {
        onSuccess: () => {
          void trpc.graphs.getById.invalidate();
          void trpc.graphs.getAll.invalidate();
          toaster.create({
            title: "Alert removed",
            type: "success",
          });
          closeDrawer();
        },
        onError: () => {
          toaster.create({
            title: "Error removing alert",
            type: "error",
          });
        },
      },
    );
  };

  // Show loading state while fetching graph data
  if (!providedForm && graphQuery.isLoading) {
    return (
      <Drawer.Root open={true} placement="end" size="md">
        <Drawer.Backdrop />
        <Drawer.Content>
          <Drawer.Header>
            <Drawer.CloseTrigger onClick={closeDrawer} />
            <HStack gap={2}>
              <Bell size={20} />
              <Drawer.Title>Configure Alert</Drawer.Title>
            </HStack>
          </Drawer.Header>
          <Drawer.Body>
            <Text>Loading graph data...</Text>
          </Drawer.Body>
        </Drawer.Content>
      </Drawer.Root>
    );
  }

  if (!form) {
    return null;
  }

  return (
    <Drawer.Root
      open={true}
      onOpenChange={() => closeDrawer()}
      placement="end"
      size="md"
    >
      <Drawer.Backdrop />
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.CloseTrigger />
          <HStack gap={2}>
            <Bell size={20} />
            <Drawer.Title>Configure Alert</Drawer.Title>
          </HStack>
        </Drawer.Header>
        <Drawer.Body>
          <VStack gap={5} align="stretch">
            <Text color="gray.600" fontSize="sm">
              Set up an alert to be notified when a metric crosses a threshold.
            </Text>

            <Field.Root>
              <Field.Label>Monitor Series</Field.Label>
              {seriesKeys.length > 1 ? (
                <NativeSelect.Root>
                  <NativeSelect.Field
                    {...form.register("alert.seriesName")}
                    value={selectedSeriesName}
                  >
                    {seriesKeys.map((sk, index) => (
                      <option key={index} value={sk.key}>
                        {sk.label}
                      </option>
                    ))}
                  </NativeSelect.Field>
                  <NativeSelect.Indicator />
                </NativeSelect.Root>
              ) : (
                <Text
                  padding={2}
                  borderWidth={1}
                  borderColor="gray.200"
                  borderRadius="md"
                  backgroundColor="gray.50"
                >
                  {seriesKeys[0]?.label || "Series 1"}
                </Text>
              )}
              {seriesKeys.length > 1 && (
                <Field.HelperText>
                  Select which series to monitor for this alert
                </Field.HelperText>
              )}
            </Field.Root>

            <HStack width="full" gap={3}>
              <Field.Root flex="1">
                <Field.Label>When value is</Field.Label>
                <NativeSelect.Root>
                  <NativeSelect.Field
                    {...form.register("alert.operator")}
                    defaultValue="gt"
                  >
                    <option value="gt">Greater than</option>
                    <option value="lt">Less than</option>
                    <option value="gte">Greater than or equal</option>
                    <option value="lte">Less than or equal</option>
                    <option value="eq">Equal to</option>
                  </NativeSelect.Field>
                  <NativeSelect.Indicator />
                </NativeSelect.Root>
              </Field.Root>

              <Field.Root flex="1">
                <Field.Label>Threshold</Field.Label>
                <Input
                  type="number"
                  step="any"
                  {...form.register("alert.threshold", {
                    valueAsNumber: true,
                    setValueAs: (v) => (isNaN(v) ? 0 : v),
                  })}
                  placeholder="0"
                  defaultValue={0}
                />
              </Field.Root>
            </HStack>

            <Field.Root>
              <Field.Label>Check over last</Field.Label>
              <NativeSelect.Root>
                <NativeSelect.Field
                  {...form.register("alert.timePeriod", {
                    valueAsNumber: true,
                  })}
                  defaultValue={60}
                >
                  <option value={5}>5 minutes</option>
                  <option value={15}>15 minutes</option>
                  <option value={30}>30 minutes</option>
                  <option value={60}>1 hour</option>
                  <option value={1440}>1 day</option>
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
            </Field.Root>

            <Field.Root>
              <Field.Label>Alert Type</Field.Label>
              <NativeSelect.Root>
                <NativeSelect.Field
                  {...form.register("alert.type")}
                  defaultValue="WARNING"
                >
                  <option value="INFO">Info</option>
                  <option value="WARNING">Warning</option>
                  <option value="CRITICAL">Critical</option>
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
            </Field.Root>

            <Field.Root>
              <Field.Label>Notification Method</Field.Label>
              <Text fontSize="sm" color="gray.500" marginBottom={3}>
                Select how you would like to be notified when the alert is
                triggered.
              </Text>
              <RadioGroup
                value={alertAction}
                onValueChange={(e) => {
                  const value = e.value as "SEND_EMAIL" | "SEND_SLACK_MESSAGE";
                  setAlertAction(value);
                  form.setValue("alert.action", value);
                }}
              >
                <Stack gap={4}>
                  <VStack align="start">
                    <Radio
                      value="SEND_SLACK_MESSAGE"
                      colorPalette="orange"
                      alignItems="start"
                      gap={3}
                      paddingTop={2}
                    >
                      <VStack align="start" marginTop={-1}>
                        <Text fontWeight="500">Send Slack Message</Text>
                        <Text fontSize="13px" fontWeight="normal">
                          Add your Slack webhook URL to send a message when the
                          alert is triggered.
                        </Text>
                      </VStack>
                    </Radio>
                    {alertAction === "SEND_SLACK_MESSAGE" && (
                      <Input
                        placeholder="Your Slack webhook URL"
                        {...form.register("alert.actionParams.slackWebhook")}
                        marginLeft={7}
                        width="calc(100% - 28px)"
                      />
                    )}
                  </VStack>

                  <Tooltip
                    content="Add a SendGrid API key or AWS SES credentials to your environment variables to enable email functionality."
                    positioning={{ placement: "top" }}
                    showArrow
                    disabled={hasEmailProvider}
                  >
                    <VStack align="start" width="full">
                      <Radio
                        value="SEND_EMAIL"
                        colorPalette="orange"
                        alignItems="start"
                        gap={3}
                        paddingTop={2}
                        disabled={!hasEmailProvider}
                      >
                        <VStack align="start" marginTop={-1}>
                          <Text fontWeight="500">Email</Text>
                          <Text fontSize="13px" fontWeight="normal">
                            Receive an email with the details when the alert is
                            triggered.
                          </Text>
                        </VStack>
                      </Radio>
                      {alertAction === "SEND_EMAIL" && <MultiSelect />}
                    </VStack>
                  </Tooltip>
                </Stack>
              </RadioGroup>
            </Field.Root>
          </VStack>
        </Drawer.Body>
        <DrawerFooter>
          <HStack width="full" justify="space-between">
            {alertEnabled && (
              <Button
                variant="ghost"
                colorPalette="red"
                onClick={handleRemoveAlert}
                loading={updateGraphById.isLoading}
              >
                <Trash size={16} />
                Remove Alert
              </Button>
            )}
            <HStack gap={2} marginLeft="auto">
              <Button
                variant="outline"
                onClick={closeDrawer}
                disabled={updateGraphById.isLoading}
              >
                Cancel
              </Button>
              <Button
                colorPalette="orange"
                onClick={handleSave}
                loading={updateGraphById.isLoading}
              >
                {alertEnabled ? "Update Alert" : "Add Alert"}
              </Button>
            </HStack>
          </HStack>
        </DrawerFooter>
      </Drawer.Content>
    </Drawer.Root>
  );
}
