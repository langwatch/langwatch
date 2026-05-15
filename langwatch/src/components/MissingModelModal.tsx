import {
  Button,
  HStack,
  Link,
  Text,
  VStack,
} from "@chakra-ui/react";
import NextLink from "~/utils/compat/next-link";
import { AlertCircle } from "lucide-react";
import { Dialog } from "./ui/dialog";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";
import {
  useMissingModelModalStore,
  type MissingModelInfo,
} from "../stores/missingModelModalStore";

/**
 * Modal opened by the global tRPC / Hono error interceptors when an API
 * call fails with a `ModelNotConfiguredError` (cause code
 * "MODEL_NOT_CONFIGURED"). Mirrors the `UpgradeModal` pattern: a singleton
 * store drives `isOpen`; this component is mounted once at the app root.
 *
 * UX contract is set by `specs/model-providers/missing-model-popup.feature`.
 */
const ROLE_LABEL: Record<MissingModelInfo["role"], string> = {
  DEFAULT: "Default",
  FAST: "Fast",
  EMBEDDINGS: "Embeddings",
};

export function MissingModelModal() {
  const { isOpen, info, close } = useMissingModelModalStore();

  return (
    <Dialog.Root open={isOpen} onOpenChange={(e) => !e.open && close()}>
      <Dialog.Content bg="bg" data-testid="missing-model-modal">
        <Dialog.CloseTrigger />
        {info && <Body info={info} onClose={close} />}
      </Dialog.Content>
    </Dialog.Root>
  );
}

function Body({
  info,
  onClose,
}: {
  info: MissingModelInfo;
  onClose: () => void;
}) {
  const { project, hasPermission } = useOrganizationTeamProject();
  const roleLabel = ROLE_LABEL[info.role];

  // Only org or project admins can configure default models. Lite members
  // and read-only viewers see the explanation but no Configure CTA — the
  // body advises them to ask an admin instead.
  const canConfigure =
    hasPermission("organization:manage") || hasPermission("project:update");

  const settingsHref = project
    ? `/${project.slug}/settings/model-providers#role-${info.role.toLowerCase()}`
    : "/settings/model-providers";

  // Feature-override deep-link expands the role row AND scrolls to the
  // specific feature line under it.
  const featureOverrideHref = `${settingsHref}?expand=${info.role.toLowerCase()}&feature=${encodeURIComponent(info.featureKey)}`;

  return (
    <VStack align="stretch" gap={4} padding={6}>
      <HStack gap={3} align="center">
        <AlertCircle size={28} color="var(--chakra-colors-orange-fg)" />
        <Dialog.Title>
          Model not configured for {info.featureDisplayName}
        </Dialog.Title>
      </HStack>

      <VStack align="stretch" gap={2}>
        <Text fontSize="sm" color="fg.muted">
          The <strong>{roleLabel}</strong> role has no model set for this
          project, its team, or its organization. Without a model,{" "}
          <strong>{info.featureDisplayName}</strong> can't run.
        </Text>
        <Text fontSize="sm" color="fg.muted">
          {canConfigure ? (
            <>
              You can pick a model for the whole {roleLabel} role, or{" "}
              <Link asChild>
                <NextLink
                  href={featureOverrideHref}
                  onClick={onClose}
                  data-testid="missing-model-feature-link"
                >
                  customize for {info.featureDisplayName} instead
                </NextLink>
              </Link>
              .
            </>
          ) : (
            <>
              Ask an organization or project admin to configure the{" "}
              {roleLabel} model.
            </>
          )}
        </Text>
      </VStack>

      <HStack gap={2} justify="end">
        <Button variant="ghost" onClick={onClose}>
          Dismiss
        </Button>
        {canConfigure && (
          <Button
            asChild
            colorPalette="orange"
            data-testid="missing-model-configure-cta"
          >
            <NextLink href={settingsHref} onClick={onClose}>
              Configure {roleLabel} model
            </NextLink>
          </Button>
        )}
      </HStack>
    </VStack>
  );
}
