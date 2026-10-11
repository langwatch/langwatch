import { useMintPersonalToken } from "@langwatch/api-key-client";
import { Banner } from "@langwatch/design-system/banner";
import { SnippetPreview } from "@langwatch/design-system/code-preview";
import { InlineCode } from "@langwatch/design-system/inline-code";
import {
  API_KEY_PLACEHOLDER,
  PersonalAccessTokenBanner,
} from "@langwatch/design-system/personal-access-token-banner";
import { Button, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { Copy } from "lucide-react";
import { useState } from "react";

import {
  usePersonalToaster,
  useShowErrorToast,
} from "../../behavior/personal-workspace-feedback.ts";
import {
  useCurrentUser,
  usePersonalDeployment,
} from "../../behavior/personal-workspace-session.ts";
import { Link } from "../elements/personal-link.tsx";

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
  const [copyFailed, setCopyFailed] = useState<string | null>(null);
  const [envVisible, setEnvVisible] = useState(true);
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

  const copy = async ({ text, what }: { text: string; what: string }): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      setCopyFailed(what);
      return false;
    }
    setCopyFailed(null);
    toaster.create({ title: `${what} copied to clipboard`, type: "success" });
    return true;
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
          onClick={() => void copy({ text: endpoint, what: "Endpoint" })}
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
        <SnippetPreview
          code={envVars}
          filename=".env"
          codeLanguage="bash"
          sensitiveValue={token ?? void 0}
          enableVisibilityToggle={!!token}
          isVisible={envVisible}
          onToggleVisibility={() => setEnvVisible(!envVisible)}
          copyText={envVars}
          disableActions={!token}
          copy={copy}
        />
      )}

      {copyFailed && (
        <Banner status="error">
          Couldn't copy the {copyFailed.toLowerCase()} to the clipboard. Select it and copy it by
          hand, or try again.
        </Banner>
      )}

      <Text fontSize="xs" color="fg.muted">
        For ad-hoc / custom telemetry. Spans land as-emitted; cost / tokens / model are not
        auto-populated unless your spans already follow <InlineCode>gen_ai.*</InlineCode>{" "}
        conventions. If your admin has set up tools, tool-specific setup is on{" "}
        <Link href="/me" fontWeight="medium">
          Your AI tools
        </Link>
        .
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
