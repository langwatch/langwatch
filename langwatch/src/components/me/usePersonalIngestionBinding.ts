import { useMemo, useState } from "react";

import type { IngestionBindingResult } from "~/components/me/IngestionTemplateInstallDrawer";
import { toaster } from "~/components/ui/toaster";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import { api } from "~/utils/api";

/**
 * Single-template personal-ingestion flow, shared by the /me Trace Ingest
 * grid and the AI Tools portal Claude Code tile. Encapsulates the templates +
 * ingestion-keys lookup, mint / rotate mutations, the "shown once" token
 * result, and the resolved personal OTLP endpoint (`{BASE_HOST}/api/otel`,
 * the receiver that auto-shapes the spans into canonical gen_ai.* cost +
 * tokens). Feed the returned values straight into
 * IngestionTemplateInstallDrawer.
 *
 * Returns `template: null` when the org has no enabled template for the
 * given slug, so callers can gate their entry point on availability.
 */
export function usePersonalIngestionBinding({
  organizationId,
  slug,
  enabled = true,
}: {
  organizationId: string;
  slug: string;
  enabled?: boolean;
}) {
  const ready = enabled && !!organizationId;

  const templatesQuery = api.ingestionTemplates.list.useQuery(
    { organizationId },
    { enabled: ready, refetchOnWindowFocus: false },
  );
  const keysQuery = api.ingestionKey.list.useQuery(
    { organizationId },
    { enabled: ready, refetchOnWindowFocus: false },
  );

  const utils = api.useUtils();
  const installMutation = api.ingestionKey.install.useMutation({
    onSuccess: () => {
      void utils.ingestionKey.list.invalidate();
    },
    onError: (err) => {
      toaster.create({
        title: "Install failed",
        description: err.message,
        type: "error",
      });
    },
  });
  const rotateMutation = api.ingestionKey.rotate.useMutation({
    onSuccess: () => {
      void utils.ingestionKey.list.invalidate();
    },
    onError: (err) => {
      toaster.create({
        title: "Rotate failed",
        description: err.message,
        type: "error",
      });
    },
  });

  const publicEnv = usePublicEnv();
  const endpoint = publicEnv.data?.BASE_HOST
    ? `${publicEnv.data.BASE_HOST}/api/otel`
    : "/api/otel";

  const template = useMemo(
    () => templatesQuery.data?.find((t) => t.slug === slug) ?? null,
    [templatesQuery.data, slug],
  );
  const existingKey = useMemo(
    () =>
      template
        ? keysQuery.data?.find((k) => k.sourceType === template.sourceType) ??
          null
        : null,
    [keysQuery.data, template],
  );

  const [installResult, setInstallResult] =
    useState<IngestionBindingResult | null>(null);

  const install = async () => {
    if (!template) return;
    try {
      const result = await installMutation.mutateAsync({
        organizationId,
        sourceType: template.sourceType,
        templateId: template.id,
      });
      setInstallResult({ token: result.token, endpoint });
    } catch {
      // surfaced via toaster + drawer error state
    }
  };

  const rotate = async () => {
    if (!template) return;
    try {
      const result = await rotateMutation.mutateAsync({
        organizationId,
        sourceType: template.sourceType,
        templateId: template.id,
      });
      setInstallResult({ token: result.token, endpoint });
    } catch {
      // surfaced via toaster + drawer error state
    }
  };

  return {
    template,
    hasExistingKey: !!existingKey,
    installResult,
    isInstalling: installMutation.isPending || rotateMutation.isPending,
    installError:
      installMutation.error?.message ?? rotateMutation.error?.message ?? null,
    endpoint,
    isLoading: templatesQuery.isLoading || keysQuery.isLoading,
    install,
    rotate,
    clearResult: () => setInstallResult(null),
  };
}
