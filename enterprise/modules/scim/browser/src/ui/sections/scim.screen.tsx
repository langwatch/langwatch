// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * SCIM provisioning, read top to bottom as the reader's question narrows: is
 * it working, is it working on the right people, what to paste into the
 * identity provider. `sso:view` reads it; `sso:manage` issues and revokes a
 * token, and a reader without it is offered no control at all.
 */

import { Alert, Heading, HStack, Spacer, Text, VStack } from "@chakra-ui/react";
import { Lock } from "lucide-react";

import { scimApi } from "../../behavior/scim-api.ts";
import { isRunningConnection } from "../../model/connection-lifecycle.ts";
import { SCIM_PAGE_PERMISSION, useScimHost } from "../../model/scim-host.ts";
import { CopyInput } from "../elements/copy-input.tsx";
import { DirectoryMembers } from "./directory-members.tsx";
import { DirectoryReconciliation } from "./directory-reconciliation.tsx";
import { DirectoryRequests } from "./directory-requests.tsx";
import { ProvisioningTokens } from "./provisioning-tokens.tsx";

export default function ScimScreen() {
  const organizationId = useScimHost().organizationId();

  if (!organizationId) return null;

  return <ScimSettingsContent organizationId={organizationId} title="SCIM Provisioning" />;
}

export function ScimSettingsContent({
  organizationId,
  title,
  lede,
}: {
  organizationId: string;
  title: string;
  /** One line under the title saying what the page is for. */
  lede?: string;
}) {
  const host = useScimHost();
  const connections = scimApi.scimToken.connections.useQuery({ organizationId });
  const maySeeSync = host.hasPermission(SCIM_PAGE_PERMISSION);
  const mayManageTokens = host.hasPermission("sso:manage");
  const mayReadMembership = host.hasPermission("organization:manage");

  return (
    <VStack gap={6} width="full" align="stretch">
      <VStack align="start" gap={1} width="full">
        <HStack width="full">
          <Heading>{title}</Heading>
          <Spacer />
        </HStack>
        {lede && <Text color="fg.muted">{lede}</Text>}
      </VStack>

      {maySeeSync ? (
        <>
          <DirectoryReconciliation
            organizationId={organizationId}
            maySetUpSingleSignOn={mayManageTokens}
          />

          {mayReadMembership && <DirectoryMembers organizationId={organizationId} />}

          <VStack gap={2} align="stretch" width="full">
            <Heading size="sm">Where your identity provider sends it</Heading>
            <Text color="fg.muted" fontSize="sm">
              Your identity provider talks to us over SCIM. Each token works against one single
              sign-on connection: it manages the people that connection provisioned, and can take on
              members no directory has claimed yet.
            </Text>
            <Text fontWeight="600" fontSize="sm">
              Provisioning address
            </Text>
            <CopyInput value={host.scimBaseUrl()} label="Provisioning address" />
            <Text color="fg.muted" fontSize="xs">
              Paste this into your identity provider, with a token from below.
            </Text>
          </VStack>

          <ProvisioningTokens organizationId={organizationId} mayManage={mayManageTokens} />

          <DirectoryRequests
            organizationId={organizationId}
            connections={(connections.data ?? []).filter((option) =>
              isRunningConnection({ connectionState: option.state }),
            )}
          />
        </>
      ) : (
        <Alert.Root status="warning">
          <Alert.Indicator>
            <Lock size={16} />
          </Alert.Indicator>
          <Alert.Content>
            <Alert.Title>Access Restricted</Alert.Title>
            <Alert.Description>
              {`You don't have permission to view this content. Required permission: ${SCIM_PAGE_PERMISSION}. Ask your team administrator to request access.`}
            </Alert.Description>
          </Alert.Content>
        </Alert.Root>
      )}
    </VStack>
  );
}
