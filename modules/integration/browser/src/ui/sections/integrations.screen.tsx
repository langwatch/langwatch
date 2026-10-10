/**
 * Settings → Integrations: Slack for every member, GitHub for organization managers. The page
 * guards on `organization:view` and each card gates its own writes, so a project admin still
 * reaches a project-scoped connection. Specs: modules/slack/specs/slack-connections.feature.
 */

import { PageLayout } from "@langwatch/design-system/page-layout";
import { Skeleton, Text, VStack } from "@langwatch/design-system/primitives";
import { useEffect } from "react";

import { useGithubHost } from "../../model/github-host.ts";
import { GITHUB_ERROR_QUERY_KEY } from "../../model/github-install-address.ts";
import { GithubCard } from "./github-card.tsx";
import { LangyCodeAccess } from "./langy-code-access.tsx";
import { SlackCard } from "./slack-card.tsx";

export default function IntegrationsScreen() {
  const host = useGithubHost();
  const organizationId = host.scope().organizationId;
  const managesOrganization = host.hasPermission("organization:manage");

  const reportedError = host.route().query[GITHUB_ERROR_QUERY_KEY];
  useEffect(() => {
    if (typeof reportedError !== "string" || reportedError.length === 0) return;

    host.failed({
      error: void 0,
      fallbackTitle: "GitHub installation failed",
      description: reportedError,
    });
    // Reported once. Left in the address it would be reported again on every
    // reload, which is the platform page's own reason for dropping it here.
    host.setQuery({ [GITHUB_ERROR_QUERY_KEY]: void 0 }, { replace: true });
    // Keyed only on the error value: the host is rebuilt whenever the address
    // changes, so depending on it would re-run this on the write above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportedError]);

  return (
    <>
      <PageLayout.Header>
        <PageLayout.Heading>Integrations</PageLayout.Heading>
      </PageLayout.Header>
      <VStack align="stretch" gap={6} width="full" paddingTop={4}>
        <Text color="fg.muted">
          Connect the tools your team already uses, so automations and Langy can reach them.
        </Text>
        {organizationId ? (
          <>
            <SlackCard />
            {managesOrganization ? (
              <GithubCard organizationId={organizationId} />
            ) : (
              <LangyCodeAccess standalone />
            )}
          </>
        ) : (
          <Skeleton data-testid="integrations-loading" height="120px" />
        )}
      </VStack>
    </>
  );
}
