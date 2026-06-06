// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  Box,
  Button,
  Heading,
  HStack,
  Input,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useState } from "react";

import { Tooltip } from "~/components/ui/tooltip";
import { toaster } from "~/components/ui/toaster";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

const SECRET_MASK = "•".repeat(40);

/**
 * Admin panel for COMPANY-WIDE push ingestion: a sysadmin mints one ingest-only
 * `sk-lw-` key bound to the org's hidden Governance Project and pastes it,
 * together with the OTLP endpoint, into a company-wide tool's OTLP exporter
 * (e.g. Microsoft Copilot Studio). The whole company's telemetry then pushes
 * into the single Governance Project. The token is revealed exactly once.
 */
export function CompanyWideIngestionPanel() {
  const { organization } = useOrganizationTeamProject();
  const organizationId = organization?.id ?? "";

  const [sourceType, setSourceType] = useState("copilot_studio");
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);

  const list = api.ingestionKey.companyWideList.useQuery(
    { organizationId },
    { enabled: !!organizationId },
  );
  const install = api.ingestionKey.companyWideInstall.useMutation({
    onSuccess: (result) => {
      setRevealedToken(result.token);
      setShowSecret(true);
      void list.refetch();
      toaster.create({
        title: "Company-wide ingestion key generated",
        description: "Copy it now — it is shown only once.",
        type: "success",
      });
    },
    onError: (error) => {
      toaster.create({
        title: "Could not generate key",
        description: error.message,
        type: "error",
      });
    },
  });

  const endpoint = list.data?.endpoint ?? "";
  const sources = list.data?.sources ?? [];
  const alreadyConnected = sources.some((s) => s.sourceType === sourceType);

  const copy = (value: string, label: string) => {
    void navigator.clipboard.writeText(value);
    toaster.create({ title: `${label} copied`, type: "success" });
  };

  return (
    <Box
      borderWidth="1px"
      borderColor="gray.200"
      borderRadius="lg"
      padding={6}
      width="full"
    >
      <VStack align="stretch" gap={4}>
        <Box>
          <Heading size="md">Company-wide push ingestion</Heading>
          <Text color="gray.600" fontSize="sm" marginTop={1}>
            Mint one ingestion key for the whole organization and paste it into a
            company-wide tool&apos;s OTLP endpoint (for example Microsoft Copilot
            Studio). Every team&apos;s telemetry then flows into this
            organization&apos;s Governance Project. The key is write-only: it can
            create traces and nothing else.
          </Text>
        </Box>

        <Box>
          <Text fontSize="sm" fontWeight="medium" marginBottom={1}>
            OTLP endpoint
          </Text>
          <HStack>
            <Input value={endpoint} readOnly fontFamily="mono" fontSize="sm" />
            <Button
              size="sm"
              variant="outline"
              onClick={() => copy(endpoint, "Endpoint")}
              disabled={!endpoint}
            >
              Copy
            </Button>
          </HStack>
        </Box>

        <Box>
          <Text fontSize="sm" fontWeight="medium" marginBottom={1}>
            Source label
          </Text>
          <HStack>
            <Input
              value={sourceType}
              onChange={(e) => setSourceType(e.target.value.trim())}
              placeholder="copilot_studio"
              fontFamily="mono"
              fontSize="sm"
            />
            <Tooltip
              content="Stamped as langwatch.source on every span so you can filter the Governance Project by tool."
              showArrow
            >
              <Button
                colorPalette="orange"
                size="sm"
                loading={install.isPending}
                disabled={!organizationId || sourceType.length === 0}
                onClick={() =>
                  install.mutate({ organizationId, sourceType })
                }
              >
                {alreadyConnected ? "Rotate key" : "Generate key"}
              </Button>
            </Tooltip>
          </HStack>
        </Box>

        {revealedToken && (
          <Box
            borderWidth="1px"
            borderColor="orange.200"
            background="orange.50"
            borderRadius="md"
            padding={4}
          >
            <Text fontSize="sm" fontWeight="medium" marginBottom={1}>
              Ingestion key (shown once)
            </Text>
            <HStack>
              <Input
                value={showSecret ? revealedToken : SECRET_MASK}
                readOnly
                fontFamily="mono"
                fontSize="sm"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowSecret((s) => !s)}
              >
                {showSecret ? "Hide" : "Show"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => copy(revealedToken, "Token")}
              >
                Copy
              </Button>
            </HStack>
            <Text color="gray.600" fontSize="xs" marginTop={2}>
              Set OTEL_EXPORTER_OTLP_ENDPOINT to the endpoint above and
              OTEL_EXPORTER_OTLP_HEADERS to{" "}
              <code>Authorization=Bearer &lt;this key&gt;</code>.
            </Text>
          </Box>
        )}

        {sources.length > 0 && (
          <Box>
            <Text fontSize="sm" fontWeight="medium" marginBottom={1}>
              Connected sources
            </Text>
            <VStack align="stretch" gap={1}>
              {sources.map((s) => (
                <HStack key={s.apiKeyId} fontSize="sm" color="gray.700">
                  <Text fontFamily="mono">{s.sourceType}</Text>
                  <Text color="green.600">connected</Text>
                </HStack>
              ))}
            </VStack>
          </Box>
        )}
      </VStack>
    </Box>
  );
}
