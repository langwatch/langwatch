import { useMintPersonalToken } from "@langwatch/api-key-client";
import {
  API_KEY_PLACEHOLDER,
  PersonalAccessTokenBanner,
} from "@langwatch/design-system/personal-access-token-banner";
import { Box, Button, HStack, Spacer, Text, VStack } from "@langwatch/design-system/primitives";
import { Copy } from "lucide-react";

import {
  usePersonalToaster,
  useShowErrorToast,
} from "../../behavior/personal-workspace-feedback.ts";
import {
  useCurrentUser,
  usePersonalDeployment,
} from "../../behavior/personal-workspace-session.ts";

/** The token lives in this component's memory only, for this project and user. */
export function PersonalOtlpEndpointPanel({
  organizationId,
  projectId,
}: {
  organizationId: string;
  projectId: string;
}) {
  const toaster = usePersonalToaster();
  const showErrorToast = useShowErrorToast();
  const minting = useMintPersonalToken({
    organizationId,
    projectId,
    userId: useCurrentUser()?.id,
    name: "Personal access token",
  });
  const token = minting.token ?? null;
  const { appBaseUrl: baseHost } = usePersonalDeployment();
  const endpoint = baseHost ? `${baseHost}/api/otel` : "";

  const envVars = endpoint
    ? `export OTEL_EXPORTER_OTLP_ENDPOINT="${endpoint}"
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer ${token ?? API_KEY_PLACEHOLDER}"`
    : "";

  const createToken = () => {
    minting
      .mint()
      .catch((error: unknown) =>
        showErrorToast({ error, fallbackTitle: "Couldn't create the personal access token" }),
      );
  };

  const copy = (value: string, label: string) => {
    void navigator.clipboard.writeText(value);
    toaster.create({ title: `${label} copied to clipboard`, type: "success" });
  };

  return (
    <VStack align="stretch" gap={3}>
      <Row label="Endpoint">
        <Text fontSize="sm" fontFamily="mono" wordBreak="break-all" flex={1}>
          {endpoint || "—"}
        </Text>
        <Button
          size="xs"
          variant="ghost"
          onClick={() => copy(endpoint, "Endpoint")}
          disabled={!endpoint}
        >
          <Copy size={12} /> Copy
        </Button>
      </Row>

      <PersonalAccessTokenBanner
        token={token}
        isCreating={minting.isMinting}
        onCreate={createToken}
        scopeNote={minting.scopeNote}
      />

      {envVars && (
        <Box
          borderWidth="1px"
          borderColor="border.muted"
          borderRadius="sm"
          padding={3}
          backgroundColor="bg.subtle"
        >
          <HStack alignItems="start" marginBottom={2}>
            <Text fontSize="xs" color="fg.muted" fontWeight="semibold">
              .env (bash)
            </Text>
            <Spacer />
            <Button
              size="xs"
              variant="ghost"
              disabled={!token}
              onClick={() => copy(envVars, "Env vars")}
            >
              <Copy size={12} /> Copy
            </Button>
          </HStack>
          <Box as="pre" fontSize="xs" fontFamily="mono" whiteSpace="pre-wrap">
            {envVars}
          </Box>
        </Box>
      )}

      <Text fontSize="xs" color="fg.muted">
        For ad-hoc / custom telemetry. Spans land as-emitted; cost / tokens / model are not
        auto-populated unless your spans already follow <code>gen_ai.*</code> conventions. For
        tool-specific auto-shape, use the catalog tiles on /me when available.
      </Text>
    </VStack>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <HStack alignItems="center" gap={3}>
      <Text fontSize="sm" color="fg.muted" minWidth="80px">
        {label}
      </Text>
      {children}
    </HStack>
  );
}
