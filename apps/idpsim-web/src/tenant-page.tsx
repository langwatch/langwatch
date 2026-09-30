import { Badge, Button, Inline, Section, Stack } from "@langwatch/design-system-internal";
import { SimConsole } from "@langwatch/sim-console";
import { useMemo, useState } from "react";

import { tenantPath, tenantSchema } from "./api.ts";
import { RefusalCallout } from "./refusal-callout.tsx";
import { ActivityTab } from "./tenant/activity.tsx";
import { DomainTab } from "./tenant/domain.tsx";
import { ProvisioningTab } from "./tenant/provisioning.tsx";
import { SetupTab } from "./tenant/setup.tsx";
import { UsersTab } from "./tenant/users.tsx";
import { answerStatus, useAnswer } from "./use-answer.ts";

export const TENANT_TABS = [
  { id: "setup", label: "Set up" },
  { id: "provisioning", label: "Provisioning" },
  { id: "domain", label: "Domain" },
  { id: "users", label: "Users" },
  { id: "activity", label: "Activity" },
] as const;

type TabId = (typeof TENANT_TABS)[number]["id"];

const isTab = (value: string): value is TabId => TENANT_TABS.some((tab) => tab.id === value);

export const TenantPage = ({ tenantId }: { tenantId: number }) => {
  const { data, refusal, reload } = useAnswer({
    path: tenantPath({ id: tenantId }),
    schema: tenantSchema,
  });
  const [tab, setTab] = useState<TabId>("setup");
  const tabs = useMemo(
    () =>
      TENANT_TABS.map((item) => {
        if (data === undefined) return { ...item };
        if (item.id === "users") return { ...item, count: data.users.length };
        if (item.id === "domain") return { ...item, count: data.records.length };
        return { ...item };
      }),
    [data],
  );

  return (
    <SimConsole
      sim="idp"
      title="IdP simulator"
      tabs={data === undefined ? [] : tabs}
      activeTab={tab}
      onTab={(id) => {
        if (isTab(id)) setTab(id);
      }}
      status={answerStatus({ loaded: data !== undefined, refused: refusal !== undefined })}
    >
      <Section
        title={`Tenant ${tenantId}`}
        description={
          data === undefined
            ? "A simulated identity provider."
            : `A simulated identity provider that owns ${data.domain}. It speaks OIDC and SAML, provisions over SCIM, and can prove it owns its domain over DNS or HTTP.`
        }
        actions={<Button href="/">All providers</Button>}
      >
        <Stack gap={6}>
          <RefusalCallout refusal={refusal} />
          {data !== undefined && (
            <>
              <Inline gap={2} wrap>
                <Badge>{`${data.users.length.toLocaleString()} users`}</Badge>
                <Badge>{`${data.applications.length} applications`}</Badge>
                <Badge>OIDC · SAML · SCIM</Badge>
              </Inline>
              {tab === "setup" && <SetupTab tenant={data} reload={reload} />}
              {tab === "provisioning" && <ProvisioningTab tenant={data} reload={reload} />}
              {tab === "domain" && <DomainTab tenant={data} reload={reload} />}
              {tab === "users" && <UsersTab tenant={data} />}
              {tab === "activity" && <ActivityTab tenantId={data.id} />}
            </>
          )}
        </Stack>
      </Section>
    </SimConsole>
  );
};
