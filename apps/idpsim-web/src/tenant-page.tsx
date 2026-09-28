import { Badge, Button, Inline, Page, Stack, Tabs } from "@langwatch/design-system-internal";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { tenantPath, tenantSchema } from "./api.ts";
import { RefusalCallout } from "./refusal-callout.tsx";
import { ActivityTab } from "./tenant/activity.tsx";
import { DomainTab } from "./tenant/domain.tsx";
import { ProvisioningTab } from "./tenant/provisioning.tsx";
import { SetupTab } from "./tenant/setup.tsx";
import { UsersTab } from "./tenant/users.tsx";
import { useAnswer } from "./use-answer.ts";

export const TENANT_TABS = [
  { id: "setup", label: "Set up" },
  { id: "provisioning", label: "Provisioning" },
  { id: "domain", label: "Domain" },
  { id: "users", label: "Users" },
  { id: "activity", label: "Activity" },
] as const;

type TabId = (typeof TENANT_TABS)[number]["id"];

const isTab = (value: string): value is TabId => TENANT_TABS.some((tab) => tab.id === value);

/** The open tab lives in the hash, so a tab can be linked to and survives a reload. */
const useTabFromHash = () => {
  const read = () => {
    const hash = window.location.hash.replace(/^#/u, "");
    return isTab(hash) ? hash : "setup";
  };
  const [tab, setTab] = useState<TabId>(read);
  useEffect(() => {
    const onHash = () => setTab(read());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const open = (id: string) => {
    if (!isTab(id)) return;
    window.history.replaceState(null, "", `#${id}`);
    setTab(id);
  };
  return { tab, open };
};

export const TenantPage = ({ nav, tenantId }: { nav: ReactNode; tenantId: number }) => {
  const { data, refusal, reload } = useAnswer({
    path: tenantPath({ id: tenantId }),
    schema: tenantSchema,
  });
  const { tab, open } = useTabFromHash();
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
    <Page
      nav={nav}
      title={`Tenant ${tenantId}`}
      subtitle={
        data === undefined
          ? "A simulated identity provider."
          : `A simulated identity provider that owns ${data.domain}. It speaks OIDC and SAML, provisions over SCIM, and can prove it owns its domain over DNS or HTTP.`
      }
      actions={
        <Button href="/" size="sm" variant="ghost">
          All providers
        </Button>
      }
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
            <Tabs label="Tenant sections" tabs={tabs} value={tab} onChange={open} />
            {tab === "setup" && <SetupTab tenant={data} reload={reload} />}
            {tab === "provisioning" && <ProvisioningTab tenant={data} reload={reload} />}
            {tab === "domain" && <DomainTab tenant={data} reload={reload} />}
            {tab === "users" && <UsersTab tenant={data} />}
            {tab === "activity" && <ActivityTab tenantId={data.id} />}
          </>
        )}
      </Stack>
    </Page>
  );
};
