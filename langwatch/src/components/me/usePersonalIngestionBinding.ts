import { useMemo, useState } from "react";

import type { IngestionBindingResult } from "~/components/me/IngestionTemplateInstallDrawer";
import { toaster } from "~/components/ui/toaster";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import { api } from "~/utils/api";

/**
 * Single-template personal-ingestion binding flow, shared by the /me
 * Trace Ingest grid and the AI Tools portal Claude Code tile. Encapsulates
 * the templates + bindings lookup, install / rotate mutations, the
 * "shown once" token result, and the resolved personal OTLP endpoint
 * (`{BASE_HOST}/api/otel`, the receiver that auto-shapes the spans into
 * canonical gen_ai.* cost + tokens). Feed the returned values straight
 * into IngestionTemplateInstallDrawer.
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
  const bindingsQuery = api.userIngestionBindings.list.useQuery(
    { organizationId },
    { enabled: ready, refetchOnWindowFocus: false },
  );

  const utils = api.useUtils();
  const installMutation = api.userIngestionBindings.install.useMutation({
    onSuccess: () => {
      void utils.userIngestionBindings.list.invalidate();
    },
    onError: (err) => {
      toaster.create({
        title: "Install failed",
        description: err.message,
        type: "error",
      });
    },
  });
  const rotateMutation = api.userIngestionBindings.rotateToken.useMutation({
    onSuccess: () => {
      void utils.userIngestionBindings.list.invalidate();
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
  const binding = useMemo(
    () =>
      template
        ? bindingsQuery.data?.find((b) => b.templateId === template.id) ?? null
        : null,
    [bindingsQuery.data, template],
  );

  const [installResult, setInstallResult] =
    useState<IngestionBindingResult | null>(null);

  const install = async () => {
    if (!template) return;
    try {
      const result = await installMutation.mutateAsync({
        organizationId,
        templateId: template.id,
      });
      setInstallResult({ token: result.token, endpoint });
    } catch {
      // surfaced via toaster + drawer error state
    }
  };

  const rotate = async () => {
    if (!binding) return;
    try {
      const result = await rotateMutation.mutateAsync({
        organizationId,
        bindingId: binding.id,
      });
      setInstallResult({ token: result.token, endpoint });
    } catch {
      // surfaced via toaster + drawer error state
    }
  };

  return {
    template,
    hasExistingBinding: !!binding,
    installResult,
    isInstalling: installMutation.isPending || rotateMutation.isPending,
    installError:
      installMutation.error?.message ?? rotateMutation.error?.message ?? null,
    endpoint,
    isLoading: templatesQuery.isLoading || bindingsQuery.isLoading,
    install,
    rotate,
    clearResult: () => setInstallResult(null),
  };
}
