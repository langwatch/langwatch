import {
  Button,
  Field,
  Heading,
  HStack,
  Input,
  NativeSelect,
  Stack,
  Text,
  useDisclosure,
  VStack,
} from "@chakra-ui/react";
import { Trash } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { type UseFormReturn, useForm } from "react-hook-form";
import { useDrawer } from "../../hooks/useDrawer";
import { useFilterParams } from "../../hooks/useFilterParams";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { usePublicEnv } from "../../hooks/usePublicEnv";
import type { CustomGraphFormData } from "../../pages/[project]/analytics/custom/index";
import {
  customGraphFormToCustomGraphInput,
  customGraphInputToFormData,
} from "../../pages/[project]/analytics/custom/index";
import { api } from "../../utils/api";
import { HorizontalFormControl } from "../HorizontalFormControl";
import { Drawer } from "../ui/drawer";
import { Radio, RadioGroup } from "../ui/radio";
import { toaster } from "../ui/toaster";
import { Tooltip } from "../ui/tooltip";
import { AlertDrawerMultiSelect } from "./AlertDrawerMultiSelect";
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

  // Fetch graph data when graphId is provided to get the latest alert data
  const graphQuery = api.graphs.getById.useQuery(
    {
      projectId: project?.id ?? "",
      id: graphId ?? "",
    },
    {
      // Always fetch when graphId is provided to get the latest alert data
      enabled: !!graphId && !!project?.id,
    },
  );

  // Create internal form from graph data if no form was provided
  const internalForm = useForm<CustomGraphFormData>();

  // Use provided form or internal form
  const form = providedForm || internalForm;

  // Update form when graph data loads
  useEffect(() => {
    if (graphQuery.data) {
      if (providedForm) {
        // If form was provided, only update the alert data from the server
        if (graphQuery.data.alert) {
          providedForm.setValue(
            "alert",
            graphQuery.data.alert as CustomGraphFormData["alert"],
          );
        }
      } else {
        // If no form provided, populate the internal form with all graph data
        const formData = customGraphInputToFormData(
          graphQuery.data.graph as CustomGraphInput,
        );
        internalForm.reset({
          ...formData,
          title: graphQuery.data.name,
          alert: graphQuery.data.alert as CustomGraphFormData["alert"],
        });
      }
    }
  }, [graphQuery.data, providedForm, internalForm]);

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
  }, [graphQuery.data, form]);

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

  const handlePopoverChange = useCallback(
    ({ open: isOpen }: { open: boolean }) => {
      if (isOpen) {
        onOpen();
      } else {
        form?.setValue("alert.actionParams.members", selectedMembers);
        onClose();
      }
    },
    [onOpen, onClose, form, selectedMembers],
  );

  const handleMemberToggle = useCallback(
    (email: string) => {
      if (selectedMembers.includes(email)) {
        setSelectedMembers(selectedMembers.filter((m) => m !== email));
      } else {
        setSelectedMembers([...selectedMembers, email]);
      }
    },
    [selectedMembers],
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

    // Store current form values to restore on error
    const currentFormData = form.getValues();
    const previousAlert = currentFormData.alert
      ? { ...currentFormData.alert }
      : undefined;

    // Prepare the graph data with alert disabled (without mutating form state)
    const graphName = form.getValues("title");
    const currentFormValues = form.getValues();
    const graphJson = customGraphFormToCustomGraphInput(currentFormValues);

    // Create alert data with disabled state for the mutation
    const alertData = currentFormValues.alert
      ? {
          ...currentFormValues.alert,
          enabled: false,
          threshold: 0,
          seriesName: "",
          actionParams: {
            ...currentFormValues.alert.actionParams,
            members: [],
            slackWebhook: "",
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
      },
      {
        onSuccess: () => {
          // Only update form state after successful mutation
          form.setValue("alert.enabled", false);
          form.setValue("alert.threshold", 0);
          form.setValue("alert.seriesName", "");
          form.setValue("alert.actionParams.members", []);
          form.setValue("alert.actionParams.slackWebhook", "");

          void trpc.graphs.getById.invalidate();
          void trpc.graphs.getAll.invalidate();
          toaster.create({
            title: "Alert removed",
            type: "success",
          });
          closeDrawer();
        },
        onError: () => {
          // Restore previous form values on error
          if (previousAlert) {
            form.setValue("alert", previousAlert);
          }

          toaster.create({
            title: "Error removing alert",
            type: "error",
          });
        },
      },
    );
  };

  // Show loading state while fetching graph data
  if (graphQuery.isLoading) {
    return (
      <Drawer.Root open={true} placement="end" size="xl">
        <Drawer.Content>
          <Drawer.CloseTrigger />
          <Drawer.Header>
            <Heading>Configure Alert</Heading>
          </Drawer.Header>
          <Drawer.Body>
            <Text>Loading alert data...</Text>
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
      size="xl"
    >
      <Drawer.Content>
        <Drawer.CloseTrigger />
        <Drawer.Header>
          <Heading>Configure Alert</Heading>
        </Drawer.Header>
        <Drawer.Body>
          <Text color="gray.600" fontSize="sm" marginBottom={6}>
            Set up an alert to be notified when a metric crosses a threshold.
          </Text>

          <VStack gap={0} align="stretch">
            <HorizontalFormControl
              label="Monitor Series"
              helper={
                seriesKeys.length > 1
                  ? "Select which series to monitor for this alert"
                  : undefined
              }
            >
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
            </HorizontalFormControl>

            <HorizontalFormControl
              label="Condition"
              helper="Define when the alert should trigger based on the metric value"
            >
              <HStack width="full" gap={3}>
                <Field.Root flex="1">
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
                  <Input
                    type="number"
                    step="any"
                    {...form.register("alert.threshold", {
                      valueAsNumber: true,
                      setValueAs: (v) => (isNaN(v) ? 0 : v),
                    })}
                    placeholder="Threshold value"
                    defaultValue={0}
                  />
                </Field.Root>
              </HStack>
            </HorizontalFormControl>

            <HorizontalFormControl
              label="Time Period"
              helper="The time window to evaluate the metric over"
            >
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
            </HorizontalFormControl>

            <HorizontalFormControl
              label="Alert Type"
              helper="Severity level of the alert"
            >
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
            </HorizontalFormControl>

            <HorizontalFormControl
              label="Notification Method"
              helper="Choose how you want to be notified when the alert is triggered"
              direction="vertical"
            >
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
                      colorPalette="blue"
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
                      <VStack width="full" align="start" paddingLeft={7}>
                        <Input
                          placeholder="Your Slack webhook URL"
                          {...form.register("alert.actionParams.slackWebhook")}
                          width="full"
                        />
                      </VStack>
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
                        colorPalette="blue"
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
                      {alertAction === "SEND_EMAIL" && (
                        <AlertDrawerMultiSelect
                          open={open}
                          onOpenChange={handlePopoverChange}
                          selectedMembers={selectedMembers}
                          onMemberToggle={handleMemberToggle}
                          onClose={onClose}
                          members={teamWithMembers.data?.members}
                        />
                      )}
                    </VStack>
                  </Tooltip>
                </Stack>
              </RadioGroup>
            </HorizontalFormControl>
          </VStack>

          <HStack gap={2} marginTop={6}>
            <Button
              colorPalette="blue"
              onClick={handleSave}
              loading={updateGraphById.isLoading}
            >
              {alertEnabled ? "Update Alert" : "Add Alert"}
            </Button>
            <Button
              variant="outline"
              onClick={closeDrawer}
              disabled={updateGraphById.isLoading}
            >
              Cancel
            </Button>
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
          </HStack>
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}
