import {
  Alert,
  Box,
  Button,
  Card,
  Field,
  Grid,
  GridItem,
  Heading,
  HStack,
  Input,
  Skeleton,
  Spacer,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import React, { useEffect } from "react";
import { Eye, EyeOff, Plus, Trash2 } from "react-feather";
import CreatableSelect from "react-select/creatable";
import { ProjectSelector } from "../../components/DashboardLayout";
import { HorizontalFormControl } from "../../components/HorizontalFormControl";
import {
  ModelSelector,
  modelSelectorOptions,
} from "../../components/ModelSelector";
import { PermissionAlert } from "../../components/PermissionAlert";
import SettingsLayout from "../../components/SettingsLayout";
import { SmallLabel } from "../../components/SmallLabel";
import { Switch } from "../../components/ui/switch";
import { useDefaultModel } from "../../hooks/useDefaultModel";
import { useEmbeddingsModel } from "../../hooks/useEmbeddingsModel";
import { useModelProviderForm } from "../../hooks/useModelProviderForm";
import { useModelProvidersSettings } from "../../hooks/useModelProvidersSettings";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { useTopicClusteringModel } from "../../hooks/useTopicClusteringModel";
import { dependencies } from "../../injection/dependencies.client";
import { modelProviderIcons } from "../../server/modelProviders/iconsMap";
import {
  getProviderModelOptions,
  type MaybeStoredModelProvider,
  modelProviders as modelProvidersRegistry,
} from "../../server/modelProviders/registry";
import {
  DEFAULT_EMBEDDINGS_MODEL,
  DEFAULT_MODEL,
  DEFAULT_TOPIC_CLUSTERING_MODEL,
  KEY_CHECK,
} from "../../utils/constants";

// 
import { Tooltip } from "../../components/ui/tooltip";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { useDrawer } from "~/hooks/useDrawer";

// (moved: multi-create logic now lives inside the per-provider hook)

export default function ModelsPage() {
  const { project, hasPermission } =
    useOrganizationTeamProject();
  const hasModelProvidersManagePermission = hasPermission("project:manage");
  const { providers, isLoading, refetch } = useModelProvidersSettings({
    projectId: project?.id,
  });

  const { openDrawer, drawerOpen: isDrawerOpen, closeDrawer } = useDrawer();
  const isProvieDrawerOpen = isDrawerOpen("addOrEditModelProvier");

  useEffect(() => {
    void refetch();
  }, [isProvieDrawerOpen, refetch]);

  return (
    <SettingsLayout>
      <VStack gap={6} width="full" align="start">
        <HStack width="full" marginTop={2}>
          <Heading as="h2">Model Providers</Heading>
          <Spacer />
          <Tooltip
            content="You need annotations view permissions to add new scores."
            disabled={hasModelProvidersManagePermission}
          >
            <PageLayout.HeaderButton
              onClick={() => openDrawer("addOrEditModelProvier", {
                projectId : project?.id,
              })}
              disabled={!hasModelProvidersManagePermission}
            >
              <Plus /> Add Model Provider
            </PageLayout.HeaderButton>
          </Tooltip>
        </HStack>


      </VStack>
    </SettingsLayout>
  );
}

