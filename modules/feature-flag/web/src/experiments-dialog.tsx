import { Badge, HStack, Stack, Switch, Text, VStack } from "@chakra-ui/react";
import { Dialog } from "@langwatch/design-system/dialog";
import type {
  ExperimentCatalogueEntry,
  ExperimentTenantPolicy,
  ExperimentTenantScope,
  FrontendFeatureFlag,
} from "@langwatch/feature-flag-contract";

export interface ExperimentsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  experiments: readonly ExperimentCatalogueEntry[];
  isLoading?: boolean;
  /** Scopes this viewer may govern. Absent means they may only opt themselves in. */
  manageableScopes?: readonly ExperimentTenantScope[];
  onSetEnrolment: (input: { flag: FrontendFeatureFlag; enrolled: boolean }) => void;
  onSetTenantPolicy?: (input: {
    flag: FrontendFeatureFlag;
    scope: ExperimentTenantScope;
    policy: ExperimentTenantPolicy;
  }) => void;
}

function scopeLabel(scope: ExperimentTenantScope): string {
  return scope.kind === "project" ? "this project" : "this organisation";
}

function policyFor(
  entry: ExperimentCatalogueEntry,
  scope: ExperimentTenantScope,
): ExperimentTenantPolicy {
  const policy = scope.kind === "project" ? entry.projectPolicy : entry.organizationPolicy;

  return policy ?? "inherit";
}

/**
 * The experiments a person can turn on for themselves, and — where they are
 * authorised — for a whole project or organisation.
 *
 * Fully controlled: it renders what it is given and reports intent upward.
 * It holds no query, no mutation and no permission logic, so the same list
 * can be shown from anywhere without dragging transport in with it.
 */
export function ExperimentsDialog({
  open,
  onOpenChange,
  experiments,
  isLoading = false,
  manageableScopes = [],
  onSetEnrolment,
  onSetTenantPolicy,
}: ExperimentsDialogProps) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(details: { open: boolean }) => onOpenChange(details.open)}
      size="lg"
    >
      {/* Full-bleed on a phone, a centred card from md up. */}
      <Dialog.Content
        maxWidth={{ base: "100vw", md: "lg" }}
        minHeight={{ base: "100dvh", md: "auto" }}
        borderRadius={{ base: "none", md: "l3" }}
      >
        <Dialog.Header>
          <Dialog.Title>Experiments</Dialog.Title>
          <Dialog.Description color="fg.muted" fontSize="sm">
            Try features that are still being shaped. Turn one off again at any time.
          </Dialog.Description>
        </Dialog.Header>

        <Dialog.Body>
          {isLoading ? (
            <Text color="fg.muted">Loading experiments…</Text>
          ) : experiments.length === 0 ? (
            <Text color="fg.muted">
              No experiments are open to you right now. We will list them here when there are.
            </Text>
          ) : (
            <Stack gap={5} separator={<div />}>
              {experiments.map((entry) => {
                const tenantDecision =
                  entry.decision === "tenant-enabled" || entry.decision === "tenant-disabled";

                return (
                  <VStack key={entry.key} align="stretch" gap={2}>
                    <HStack justify="space-between" align="start" gap={4}>
                      <VStack align="start" gap={1}>
                        <HStack gap={2}>
                          <Text fontWeight="medium">{entry.title}</Text>
                          {tenantDecision && (
                            <Badge size="sm" colorPalette="gray">
                              Set for everyone here
                            </Badge>
                          )}
                        </HStack>
                        <Text color="fg.muted" fontSize="sm">
                          {entry.summary}
                        </Text>
                      </VStack>

                      <Switch.Root
                        checked={entry.enabled}
                        disabled={tenantDecision}
                        onCheckedChange={(details: { checked: boolean }) =>
                          onSetEnrolment({ flag: entry.key, enrolled: details.checked })
                        }
                      >
                        <Switch.HiddenInput
                          aria-label={`Turn ${entry.title} ${entry.enabled ? "off" : "on"} for me`}
                        />
                        <Switch.Control />
                      </Switch.Root>
                    </HStack>

                    {onSetTenantPolicy &&
                      manageableScopes.map((scope) => (
                        <HStack
                          key={`${entry.key}-${scope.kind}`}
                          justify="space-between"
                          gap={4}
                          paddingTop={1}
                        >
                          <Text color="fg.muted" fontSize="sm">
                            For {scopeLabel(scope)}
                          </Text>
                          <HStack gap={2}>
                            {(["inherit", "enabled", "disabled"] as const).map((policy) => (
                              <Badge
                                key={policy}
                                as="button"
                                size="sm"
                                colorPalette={policyFor(entry, scope) === policy ? "blue" : "gray"}
                                aria-pressed={policyFor(entry, scope) === policy}
                                onClick={() =>
                                  onSetTenantPolicy({
                                    flag: entry.key,
                                    scope,
                                    policy,
                                  })
                                }
                              >
                                {policy === "inherit" ? "Let people choose" : policy}
                              </Badge>
                            ))}
                          </HStack>
                        </HStack>
                      ))}
                  </VStack>
                );
              })}
            </Stack>
          )}
        </Dialog.Body>

        <Dialog.Footer />
        <Dialog.CloseTrigger />
      </Dialog.Content>
    </Dialog.Root>
  );
}
