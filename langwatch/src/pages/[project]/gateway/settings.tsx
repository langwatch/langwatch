import {
  Box,
  Button,
  Field,
  HStack,
  Heading,
  Input,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Save } from "lucide-react";
import { useEffect, useState } from "react";

import { DashboardLayout } from "~/components/DashboardLayout";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { GatewayLayout } from "~/components/gateway/GatewayLayout";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { toaster } from "~/components/ui/toaster";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

function GatewaySettingsPage() {
  const { project } = useOrganizationTeamProject();

  const endpointQuery = api.project.getObservabilityEndpoint.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id },
  );

  const [endpoint, setEndpoint] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (endpointQuery.data) {
      setEndpoint(endpointQuery.data.observabilityEndpoint ?? "");
      setDirty(false);
    }
  }, [endpointQuery.data]);

  const updateMutation = api.project.updateObservabilityEndpoint.useMutation({
    onSuccess: () => {
      toaster.create({ title: "Observability endpoint saved", type: "success" });
      setDirty(false);
      void endpointQuery.refetch();
    },
    onError: (error) => {
      toaster.create({
        title: error.message || "Failed to save",
        type: "error",
      });
    },
  });

  const submit = async () => {
    if (!project) return;
    await updateMutation.mutateAsync({
      projectId: project.id,
      observabilityEndpoint: endpoint.trim() === "" ? null : endpoint.trim(),
    });
  };

  return (
    <GatewayLayout>
      <PageLayout.Container>
        <PageLayout.Header>
          <PageLayout.Heading>Gateway Settings</PageLayout.Heading>
        </PageLayout.Header>
        <Box padding={6}>
          <VStack align="stretch" gap={6} maxWidth="720px">
            <Box>
              <Heading size="sm">Observability</Heading>
              <Text fontSize="sm" color="fg.muted" mt={1}>
                The gateway emits per-tenant OTel spans, metrics, and logs to
                this endpoint. Leave empty to use the gateway's default
                (GATEWAY_OTEL_DEFAULT_ENDPOINT).
              </Text>
            </Box>
            <Field.Root>
              <Field.Label>OTLP HTTP endpoint</Field.Label>
              <Input
                value={endpoint}
                onChange={(e) => {
                  setEndpoint(e.target.value);
                  setDirty(true);
                }}
                placeholder="https://ingest.langwatch.ai/otel/v1/traces"
              />
              <Field.HelperText>
                The gateway sends traces here via the RouterExporter on every
                span export. Changes propagate to all gateway replicas within
                ~60s (change-event long-poll period).
              </Field.HelperText>
            </Field.Root>
            <HStack>
              <Spacer />
              <Button
                colorPalette="orange"
                onClick={submit}
                loading={updateMutation.isPending}
                disabled={!dirty}
              >
                <Save size={14} /> Save
              </Button>
            </HStack>
          </VStack>
        </Box>
      </PageLayout.Container>
    </GatewayLayout>
  );
}

export default withPermissionGuard("project:update", {
  layoutComponent: DashboardLayout,
})(GatewaySettingsPage);
