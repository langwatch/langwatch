import {
  Button,
  CodeBlock,
  Inline,
  KeyValue,
  Panel,
  Select,
  Stack,
  Text,
} from "@langwatch/design-system-internal";
import { useState } from "react";
import { z } from "zod";

import { request, type TenantView } from "../api.ts";
import { RefusalCallout } from "../refusal-callout.tsx";
import { useAct } from "../use-act.ts";

const PROVIDERS = [
  { value: "generic", label: "Generic OIDC" },
  { value: "auth0", label: "Auth0" },
  { value: "okta", label: "Okta" },
  { value: "cognito", label: "Cognito" },
  { value: "onelogin", label: "OneLogin" },
  { value: "azure", label: "Azure AD / Entra" },
];

const postureSchema = z.object({ provider: z.string(), issuer: z.string(), discovery: z.string() });
type Posture = z.infer<typeof postureSchema>;

/**
 * A tenant posing as one of the providers the legacy NextAuth env lines name,
 * with the lines that point a stack at it.
 */
export const LegacyProviderPanel = ({ tenant }: { tenant: TenantView }) => {
  const [posture, setPosture] = useState<Posture | undefined>(undefined);
  const [envLines, setEnvLines] = useState("");
  const [provider, setProvider] = useState("okta");
  const { act, busy, refusal } = useAct({ onDone: () => undefined });
  const base = `/control/t/${tenant.id}`;

  const pose = async () => {
    const answer = await act({
      name: "pose",
      path: `${base}/legacy-provider`,
      method: "POST",
      body: { provider },
      schema: postureSchema,
    });
    if (answer === undefined) return;
    setPosture(answer);
    if (answer.provider === "generic") {
      setEnvLines("");
      return;
    }
    const env = await request({ path: `${base}/legacy-env`, schema: z.string() });
    setEnvLines(env.ok ? env.data : "");
  };

  return (
    <Panel title="Pose as a legacy provider" meta="NextAuth-era env lines">
      <Stack gap={4}>
        <Text tone="secondary">
          The tenant answers at the discovery path the chosen provider uses, so a stack configured
          with that provider's legacy env lines signs in here. Apply the lines with haven down, then
          haven up.
        </Text>
        <Inline gap={3} align="end" wrap>
          <Select label="Provider" options={PROVIDERS} value={provider} onChange={setProvider} />
          <Button type="button" loading={busy === "pose"} onClick={() => void pose()}>
            Pose as this provider
          </Button>
        </Inline>
        <RefusalCallout refusal={refusal} />
        {posture !== undefined && (
          <KeyValue
            items={[
              { label: "Provider", value: posture.provider },
              { label: "Issuer", value: posture.issuer },
              { label: "Discovery", value: posture.discovery },
            ]}
          />
        )}
        {envLines !== "" && <CodeBlock code={envLines} label="Legacy env lines" />}
      </Stack>
    </Panel>
  );
};
