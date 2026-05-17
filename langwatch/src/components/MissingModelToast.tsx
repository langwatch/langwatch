import { Box, HStack, Text } from "@chakra-ui/react";
import { AlertCircle } from "lucide-react";

import { toaster } from "./ui/toaster";

/**
 * Toast emitted by the global tRPC / Hono error interceptors when an API
 * call fails with a `ModelNotConfiguredError` (cause code
 * `MODEL_NOT_CONFIGURED`).
 *
 * Why toast and not modal: the previous design opened a full Dialog,
 * which felt heavy for background flows (AI search, auto-saved
 * commit-message generation). A sticky orange toast with a deep-link
 * action button is just as discoverable but doesn't trap focus.
 *
 * The toaster system already lives at the app root; we don't mount any
 * extra component for this. Stable per-(featureKey, role) toast IDs
 * dedupe retry storms so identical errors don't stack.
 *
 * UX contract: specs/model-providers/missing-model-popup.feature.
 */
export type MissingModelInfo = {
  /** Stable, area-prefixed snake_case key (e.g. "traces.ai_search"). */
  featureKey: string;
  /** User-facing label for the feature, from the dev-side registry. */
  featureDisplayName: string;
  /** Role the unresolved feature belongs to. */
  role: "DEFAULT" | "FAST" | "EMBEDDINGS";
  /** Project slug used to deep-link the action button. */
  projectSlug?: string;
  /** Whether the caller has permission to configure model providers. */
  canConfigure?: boolean;
};

const ROLE_LABEL: Record<MissingModelInfo["role"], string> = {
  DEFAULT: "Default",
  FAST: "Fast",
  EMBEDDINGS: "Embeddings",
};

export function missingModelToastId(info: MissingModelInfo): string {
  return `missing-model:${info.role}:${info.featureKey}`;
}

function currentProjectSlug(): string | null {
  if (typeof window === "undefined") return null;
  const segments = window.location.pathname.split("/").filter(Boolean);
  // App URLs are `/{slug}/...` for project-scoped pages; first segment
  // is the slug. Reserved prefixes ("settings", "auth", "onboarding")
  // don't carry a project slug, so we treat them as "no slug" and the
  // settings link falls back to the bare path.
  const first = segments[0];
  if (!first) return null;
  if (["settings", "auth", "onboarding", "api"].includes(first)) return null;
  return first;
}

function settingsHref(info: MissingModelInfo): string {
  const slug = info.projectSlug ?? currentProjectSlug();
  const base = slug
    ? `/${slug}/settings/model-providers`
    : "/settings/model-providers";
  return `${base}#role-${info.role.toLowerCase()}`;
}

/**
 * Open (or refresh) the missing-model toast. Safe to call from a tRPC
 * onError without React context — the toaster is a global singleton.
 */
export function showMissingModelToast(info: MissingModelInfo): void {
  const id = missingModelToastId(info);
  if (toaster.isVisible(id)) return;
  const roleLabel = ROLE_LABEL[info.role];
  const href = settingsHref(info);

  toaster.create({
    id,
    type: "warning",
    duration: Infinity,
    title: (
      <HStack gap={2} align="center">
        <AlertCircle size={16} color="var(--chakra-colors-orange-fg)" />
        <Text fontWeight="medium">
          Model not configured for {info.featureDisplayName}
        </Text>
      </HStack>
    ) as unknown as string,
    description: (
      <Box fontSize="sm" color="fg.muted">
        {info.canConfigure === false ? (
          <Text>
            Ask an organization or project admin to set a {roleLabel} model.
          </Text>
        ) : (
          <Text>
            Pick a {roleLabel} model in Model Providers settings to enable{" "}
            {info.featureDisplayName}.
          </Text>
        )}
      </Box>
    ) as unknown as string,
    action:
      info.canConfigure === false
        ? undefined
        : {
            label: `Configure ${roleLabel} model`,
            onClick: () => {
              toaster.dismiss(id);
              window.location.assign(href);
            },
          },
    meta: { closable: true, type: "missing-model" },
  });
}

/**
 * Variant for downstream AI-call failures that aren't a
 * MODEL_NOT_CONFIGURED — e.g. the provider returns 401 because the
 * caller's API key is wrong, or the SDK throws because a custom model
 * id no longer exists in the registry. The user-facing toast adds a
 * "double-check your model configuration" hint so the most common
 * cause (a misconfigured provider) is the first thing they think to
 * verify.
 */
export type AiCallFailedInfo = {
  featureKey: string;
  featureDisplayName: string;
  role: MissingModelInfo["role"];
  projectSlug?: string;
  /** Best-effort short error message from the provider/SDK. */
  errorMessage?: string;
};

export function aiCallFailedToastId(info: AiCallFailedInfo): string {
  return `ai-call-failed:${info.role}:${info.featureKey}`;
}

export function showAiCallFailedToast(info: AiCallFailedInfo): void {
  const id = aiCallFailedToastId(info);
  if (toaster.isVisible(id)) return;
  const roleLabel = ROLE_LABEL[info.role];
  const href = settingsHref({ ...info, canConfigure: true });

  toaster.create({
    id,
    type: "error",
    duration: 10000,
    title: (
      <Text fontWeight="medium">{info.featureDisplayName} failed</Text>
    ) as unknown as string,
    description: (
      <Box fontSize="sm" color="fg.muted">
        <Text>
          Double-check your {roleLabel} model configuration in Model
          Providers.
        </Text>
        {info.errorMessage && (
          <Text marginTop="1" fontSize="xs" color="fg.subtle">
            {info.errorMessage}
          </Text>
        )}
      </Box>
    ) as unknown as string,
    action: {
      label: "Open settings",
      onClick: () => {
        toaster.dismiss(id);
        window.location.assign(href);
      },
    },
    meta: { closable: true, type: "ai-call-failed" },
  });
}
