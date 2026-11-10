/**
 * Settings › Project › Langy: which models Langy may run on in this project.
 * Spec: specs/langy/langy-model-allowlist.feature
 */

import { Banner } from "@langwatch/design-system/banner";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { Box, Button, Skeleton, Text, VStack } from "@langwatch/design-system/primitives";
import { ProviderModelMultiSelector } from "@langwatch/design-system/provider-model-multi-selector";
import { SettingsSection } from "@langwatch/design-system/settings-section";
import { Bot } from "lucide-react";

import { useLangyHost } from "../../../../model/langy-host.ts";
import { useLangyVisibility } from "../../../langy/behavior/use-show-langy.ts";
import { useLangyModelAllowlist } from "../../behavior/use-langy-model-allowlist.ts";

export default function LangySettingsScreen() {
  const host = useLangyHost();
  const projectId = host.project()?.id;
  const visibility = useLangyVisibility();

  return (
    <Box width="full">
      <PageLayout.Header>
        <PageLayout.Heading>Langy</PageLayout.Heading>
      </PageLayout.Header>
      <VStack gap={6} width="full" align="stretch" paddingTop={4}>
        <Text textStyle="body" color="fg.muted">
          How Langy, the in-product assistant, works in this project.
        </Text>
        {projectId && visibility.show ? <LangyModelsSection projectId={projectId} /> : null}
        {projectId && !visibility.show && !visibility.isResolving ? (
          <NoDataInfoBlock
            size="inline"
            icon={<Bot size={18} />}
            title="Langy is not available in this project"
            description="Once Langy is on for this project, you can choose the models it may use here."
          />
        ) : null}
      </VStack>
    </Box>
  );
}

function LangyModelsSection({ projectId }: { projectId: string }) {
  const host = useLangyHost();
  const canManage = host.hasPermission("langy:manage");
  const allowlist = useLangyModelAllowlist({ projectId });
  const ready = allowlist.savedStatus === "ready";

  return (
    <SettingsSection
      icon={<Bot size={18} />}
      title="Models Langy may use"
      hint="Langy only runs on the models you pick. Leave it empty to let Langy use every model your providers serve."
      footer={
        canManage && ready ? (
          <Button
            size="sm"
            colorPalette="accent"
            onClick={allowlist.save}
            loading={allowlist.isSaving}
          >
            Save changes
          </Button>
        ) : undefined
      }
      data-testid="langy-models-section"
    >
      {allowlist.savedStatus === "loading" ? (
        <Skeleton height={10} width="full" data-testid="langy-models-loading" />
      ) : null}
      {allowlist.savedStatus === "error" ? (
        <Banner
          status="error"
          title="Couldn't load Langy's models"
          action={
            <Button size="xs" variant="outline" onClick={allowlist.retryLoad}>
              Try again
            </Button>
          }
          data-testid="langy-models-load-error"
        >
          Nothing can be saved until the current list loads.
        </Banner>
      ) : null}
      {ready ? (
        <VStack width="full" align="stretch" gap={3}>
          <ProviderModelMultiSelector
            aria-label="Models Langy may use"
            models={allowlist.models}
            query={allowlist.options}
            onChange={allowlist.setModels}
            emptyLabel="Every model your providers serve"
            disabled={!canManage}
          />
          {canManage ? null : (
            <Text textStyle="sm" color="fg.muted">
              Only project admins can change which models Langy may use.
            </Text>
          )}
          {allowlist.isDefaultOutsideList ? (
            <Banner
              status="warning"
              title="Langy's default model is not in this list"
              data-testid="langy-default-model-outside-list"
            >
              {`Chats switch to an allowed model, but anything that runs on the default model, ${allowlist.defaultModel ?? ""}, is refused. Add it here or change Langy's default model.`}
            </Banner>
          ) : null}
        </VStack>
      ) : null}
    </SettingsSection>
  );
}
