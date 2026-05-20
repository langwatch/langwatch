import {
  Badge,
  Button,
  Card,
  Field,
  Heading,
  HStack,
  Input,
  Spacer,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { HorizontalFormControl } from "~/components/HorizontalFormControl";
import { ProjectSelector } from "~/components/DashboardLayout";
import SettingsLayout from "~/components/SettingsLayout";
import { Dialog } from "~/components/ui/dialog";
import { toaster } from "~/components/ui/toaster";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

interface RetentionFormData {
  traces: string;
  scenarios: string;
  experiments: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(2)} ${units[i]}`;
}

function DataRetentionSettings() {
  const { organization, project } = useOrganizationTeamProject();
  if (!organization || !project) return null;
  return (
    <DataRetentionForm
      organizationId={organization.id}
      projectId={project.id}
    />
  );
}

export default withPermissionGuard("project:update", {
  layoutComponent: SettingsLayout,
})(DataRetentionSettings);

function DataRetentionForm({
  organizationId,
  projectId,
}: {
  organizationId: string;
  projectId: string;
}) {
  const utils = api.useUtils();
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [pendingRetroactive, setPendingRetroactive] = useState<{
    category: "traces" | "scenarios" | "experiments";
    days: number;
  } | null>(null);

  const policyQuery = api.dataRetention.getProjectPolicy.useQuery({
    projectId,
  });
  const storageQuery = api.dataRetention.getStorageBreakdown.useQuery({
    projectId,
  });
  const mutationProgressQuery = api.dataRetention.getMutationProgress.useQuery({
    projectId,
  });

  const updateProjectPolicy = api.dataRetention.updateProjectPolicy.useMutation({
    onSuccess: () => {
      utils.dataRetention.getProjectPolicy.invalidate({ projectId });
      toaster.create({
        title: "Retention policy updated",
        type: "success",
      });
    },
    onError: (error) => {
      toaster.create({
        title: "Failed to update retention policy",
        description: error.message,
        type: "error",
      });
    },
  });

  const triggerRetroactive = api.dataRetention.triggerRetroactiveUpdate.useMutation({
    onSuccess: () => {
      utils.dataRetention.getMutationProgress.invalidate({ projectId });
      toaster.create({
        title: "Retroactive update started",
        type: "success",
      });
    },
    onError: (error) => {
      toaster.create({
        title: "Failed to start retroactive update",
        description: error.message,
        type: "error",
      });
    },
  });

  const killMutation = api.dataRetention.killMutation.useMutation({
    onSuccess: () => {
      utils.dataRetention.getMutationProgress.invalidate({ projectId });
      toaster.create({
        title: "Mutation cancelled",
        type: "success",
      });
    },
  });

  const projectPolicy = policyQuery.data?.projectPolicy as Record<string, number | null> | null;
  const orgPolicy = policyQuery.data?.orgPolicy as Record<string, number | null> | null;

  const { control, handleSubmit, reset } = useForm<RetentionFormData>({
    defaultValues: {
      traces: "",
      scenarios: "",
      experiments: "",
    },
  });

  useEffect(() => {
    if (policyQuery.data) {
      const pp = projectPolicy;
      reset({
        traces: pp?.traces != null ? String(pp.traces) : "",
        scenarios: pp?.scenarios != null ? String(pp.scenarios) : "",
        experiments: pp?.experiments != null ? String(pp.experiments) : "",
      });
    }
  }, [policyQuery.data, projectPolicy, reset]);

  const onSubmit = (data: RetentionFormData) => {
    const policy = {
      traces: data.traces ? Number(data.traces) : null,
      scenarios: data.scenarios ? Number(data.scenarios) : null,
      experiments: data.experiments ? Number(data.experiments) : null,
    };

    updateProjectPolicy.mutate({
      projectId,
      retentionPolicy: policy,
    });
  };

  const handleRetroactiveUpdate = (category: "traces" | "scenarios" | "experiments", days: number) => {
    const currentDays = (projectPolicy as any)?.[category] ?? (orgPolicy as any)?.[category] ?? 0;
    if (days < currentDays && currentDays > 0) {
      setPendingRetroactive({ category, days });
      setShowConfirmDialog(true);
    } else {
      triggerRetroactive.mutate({
        projectId,
        category,
        newRetentionDays: days,
      });
    }
  };

  const confirmRetroactive = () => {
    if (pendingRetroactive) {
      triggerRetroactive.mutate({
        projectId,
        category: pendingRetroactive.category,
        newRetentionDays: pendingRetroactive.days,
      });
    }
    setShowConfirmDialog(false);
    setPendingRetroactive(null);
  };

  if (policyQuery.isLoading) {
    return (
      <VStack width="full" padding={8}>
        <Spinner />
      </VStack>
    );
  }

  const categories = [
    { key: "traces" as const, label: "Traces & Spans", description: "Traces, spans, logs, metrics, evaluations" },
    { key: "scenarios" as const, label: "Scenarios", description: "Simulation runs, suite runs" },
    { key: "experiments" as const, label: "Experiments", description: "Experiment runs and results" },
  ];

  return (
    <VStack gap={6} width="full" align="start" paddingX={6} paddingY={4}>
      <HStack width="full" marginTop={2}>
        <Heading as="h2" fontSize="xl">
          Data Retention
        </Heading>
        <Spacer />
        <ProjectSelector />
      </HStack>

      <Card.Root width="full">
        <Card.Header>
          <Heading as="h3" fontSize="lg">
            Retention Policy
          </Heading>
          <Text fontSize="sm" color="fg.muted">
            Configure how long data is kept before automatic deletion. Minimum 30
            days. Leave empty to inherit the organization default
            {orgPolicy ? ` or keep indefinitely` : ""}.
          </Text>
        </Card.Header>
        <Card.Body>
          <form onSubmit={handleSubmit(onSubmit)}>
            <VStack gap={4} align="stretch">
              {categories.map(({ key, label, description }) => (
                <HorizontalFormControl
                  key={key}
                  label={label}
                  helper={description}
                >
                  <HStack gap={2}>
                    <Controller
                      name={key}
                      control={control}
                      rules={{
                        validate: (v) => {
                          if (v === "") return true;
                          const n = Number(v);
                          if (isNaN(n) || n < 30) return "Minimum 30 days";
                          return true;
                        },
                      }}
                      render={({ field, fieldState }) => (
                        <Field.Root invalid={!!fieldState.error}>
                          <Input
                            {...field}
                            type="number"
                            placeholder={
                              orgPolicy?.[key] != null
                                ? `Org default: ${orgPolicy[key]} days`
                                : "Indefinite"
                            }
                            width="200px"
                            min={30}
                          />
                          {fieldState.error && (
                            <Field.ErrorText>
                              {fieldState.error.message}
                            </Field.ErrorText>
                          )}
                        </Field.Root>
                      )}
                    />
                    <Text fontSize="sm" color="fg.muted">
                      days
                    </Text>
                  </HStack>
                </HorizontalFormControl>
              ))}

              <HStack justifyContent="flex-end" paddingTop={2}>
                <Button
                  type="submit"
                  colorPalette="blue"
                  loading={updateProjectPolicy.isLoading}
                >
                  Save Changes
                </Button>
              </HStack>
            </VStack>
          </form>
        </Card.Body>
      </Card.Root>

      <Card.Root width="full">
        <Card.Header>
          <Heading as="h3" fontSize="lg">
            Storage Usage
          </Heading>
          <Text fontSize="sm" color="fg.muted">
            Current stored data size across all tables.
          </Text>
        </Card.Header>
        <Card.Body>
          {storageQuery.isLoading ? (
            <Spinner />
          ) : storageQuery.data ? (
            <VStack gap={3} align="stretch">
              <HStack justifyContent="space-between">
                <Text fontWeight="semibold">Total</Text>
                <Text fontWeight="bold" fontSize="lg">
                  {formatBytes(storageQuery.data.totalBytes)}
                </Text>
              </HStack>
              <HStack justifyContent="space-between">
                <Text color="fg.muted">Traces & Spans</Text>
                <Text>{formatBytes(storageQuery.data.byCategory.traces)}</Text>
              </HStack>
              <HStack justifyContent="space-between">
                <Text color="fg.muted">Scenarios</Text>
                <Text>
                  {formatBytes(storageQuery.data.byCategory.scenarios)}
                </Text>
              </HStack>
              <HStack justifyContent="space-between">
                <Text color="fg.muted">Experiments</Text>
                <Text>
                  {formatBytes(storageQuery.data.byCategory.experiments)}
                </Text>
              </HStack>
            </VStack>
          ) : null}
        </Card.Body>
      </Card.Root>

      <Card.Root width="full">
        <Card.Header>
          <Heading as="h3" fontSize="lg">
            Apply to Existing Data
          </Heading>
          <Text fontSize="sm" color="fg.muted">
            Update retention for data already stored. New data automatically uses
            the current policy.
          </Text>
        </Card.Header>
        <Card.Body>
          <VStack gap={3} align="stretch">
            {categories.map(({ key, label }) => {
              const currentValue = (projectPolicy as any)?.[key] ?? (orgPolicy as any)?.[key];
              const activeMutations = mutationProgressQuery.data?.filter(
                (m) => m.table.includes(key === "traces" ? "stored_spans" : key === "scenarios" ? "simulation_runs" : "experiment_runs"),
              ) ?? [];

              return (
                <HStack key={key} justifyContent="space-between">
                  <VStack align="start" gap={0}>
                    <Text fontWeight="medium">{label}</Text>
                    {activeMutations.length > 0 && (
                      <HStack gap={2}>
                        <Badge colorPalette="yellow">In Progress</Badge>
                        <Text fontSize="xs" color="fg.muted">
                          {activeMutations[0]?.partsToDo ?? 0} parts remaining
                        </Text>
                        <Button
                          size="xs"
                          variant="ghost"
                          colorPalette="red"
                          onClick={() => {
                            if (activeMutations[0]?.mutationId) {
                              killMutation.mutate({
                                projectId,
                                mutationId: activeMutations[0].mutationId,
                              });
                            }
                          }}
                        >
                          Cancel
                        </Button>
                      </HStack>
                    )}
                  </VStack>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!currentValue || currentValue === 0 || activeMutations.length > 0}
                    loading={triggerRetroactive.isLoading}
                    onClick={() => {
                      if (currentValue && currentValue > 0) {
                        handleRetroactiveUpdate(key, currentValue);
                      }
                    }}
                  >
                    Apply to existing data
                  </Button>
                </HStack>
              );
            })}
          </VStack>
        </Card.Body>
      </Card.Root>

      <Dialog.Root
        open={showConfirmDialog}
        onOpenChange={({ open }) => {
          if (!open) {
            setShowConfirmDialog(false);
            setPendingRetroactive(null);
          }
        }}
      >
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <Dialog.Header>
              <Dialog.Title>Confirm Retention Contraction</Dialog.Title>
            </Dialog.Header>
            <Dialog.Body>
              <Text>
                Reducing retention to {pendingRetroactive?.days} days will make
                existing data older than {pendingRetroactive?.days} days eligible
                for deletion. This cannot be undone.
              </Text>
            </Dialog.Body>
            <Dialog.Footer>
              <Button
                variant="outline"
                onClick={() => {
                  setShowConfirmDialog(false);
                  setPendingRetroactive(null);
                }}
              >
                Cancel
              </Button>
              <Button colorPalette="red" onClick={confirmRetroactive}>
                Confirm
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Root>
    </VStack>
  );
}
