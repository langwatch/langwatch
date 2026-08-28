import {
  Button,
  Field,
  HStack,
  Input,
  Separator,
  Spacer,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { useEffect, useMemo, useState } from "react";

import { Drawer } from "~/components/ui/drawer";
import { FieldInfoTooltip } from "~/components/ui/FieldInfoTooltip";
import { toaster } from "~/components/ui/toaster";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useRequiredSession } from "~/hooks/useRequiredSession";
import { api } from "~/utils/api";
import {
  buildScopeHierarchy,
  firstEligibleDefaultModel,
  type OrgModelProvider,
  resolveEligible,
} from "./eligibleModelProviders";
import {
  humanizeGatewayError,
  parseTagsCsv,
  TAGS_CSV_MAX_LENGTH,
  tagsBeyondLimitsNotice,
  VK_TAGS_FIELD_DESCRIPTION,
} from "@langwatch/gateway-web";
import {
  budgetInvalidReason,
  EMPTY_BUDGET,
  VirtualKeyBudgetSection,
  type VirtualKeyBudgetValue,
} from "./VirtualKeyBudgetSection";
import {
  NEVER_EXPIRES,
  VirtualKeyExpirationSection,
  type VirtualKeyExpirationValue,
} from "./VirtualKeyExpirationSection";
import {
  ownershipIncompleteReason,
  ownershipToScopes,
  ownershipTraceProjectId,
  type VirtualKeyOwnership,
  VirtualKeyOwnershipSection,
} from "./VirtualKeyOwnershipSection";
import {
  ALL_PROVIDERS,
  type ProviderAccessValue,
  providerAccessInvalidReason,
  providerAccessToConfig,
  VirtualKeyProviderAccessSection,
} from "./VirtualKeyProviderAccessSection";
import {
  ROUTING_NONE,
  VirtualKeyRoutingSection,
  type VirtualKeyRoutingValue,
} from "./VirtualKeyRoutingSection";
import {
  expiryFieldErrorFrom,
  expiryIncompleteReason,
  resolveExpiresAt,
} from "./virtualKeyExpiration";

type VirtualKeyCreateDrawerProps = {
  organizationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (result: {
    id: string;
    name: string;
    secret: string;
    model?: string;
  }) => void;
};

export function VirtualKeyCreateDrawer({
  organizationId,
  open,
  onOpenChange,
  onCreated,
}: VirtualKeyCreateDrawerProps) {
  const { organization, project, hasPermission } = useOrganizationTeamProject();
  const session = useRequiredSession();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tagsCsv, setTagsCsv] = useState("");
  const [ownership, setOwnership] = useState<VirtualKeyOwnership>({
    kind: "PROJECT",
    projectId: null,
    teamId: null,
    traceProjectId: null,
  });
  const [budget, setBudget] = useState<VirtualKeyBudgetValue>(EMPTY_BUDGET);
  const [providerAccess, setProviderAccess] =
    useState<ProviderAccessValue>(ALL_PROVIDERS);
  const [routing, setRouting] = useState<VirtualKeyRoutingValue>(ROUTING_NONE);
  const [expiration, setExpiration] = useState<VirtualKeyExpirationValue>(NEVER_EXPIRES);
  const [expiryFieldError, setExpiryFieldError] = useState<string | null>(null);

  const canCreateShared = hasPermission("virtualKeys:manage");

  const availableTeams = useMemo(
    () => organization?.teams?.map((t) => ({ id: t.id, name: t.name })) ?? [],
    [organization?.teams],
  );
  const availableProjects = useMemo(
    () =>
      organization?.teams?.flatMap((t) =>
        t.projects.map((p) => ({
          id: p.id,
          name: `${p.name} · ${t.name}`,
          teamId: t.id,
        })),
      ) ?? [],
    [organization?.teams],
  );

  // Seed ownership with the project the user is currently in (the
  // default shape of a key) the first time the drawer opens. The trace
  // project of an org- or team-owned key is deliberately NOT seeded:
  // where a shared key's traces and costs land is an explicit choice.
  useEffect(() => {
    if (!open) return;
    setOwnership((prev) => {
      if (prev.projectId ?? prev.teamId) return prev;
      const seedProject = project?.id ?? availableProjects[0]?.id ?? null;
      const seedTeam =
        availableTeams.length === 1 ? (availableTeams[0]?.id ?? null) : null;
      // A no-op seed must keep the previous state's identity: a fresh
      // but value-identical object re-arms this effect through its own
      // render and spins the drawer at 100% CPU in an org with no
      // projects.
      if (prev.projectId === seedProject && prev.teamId === seedTeam) {
        return prev;
      }
      return { ...prev, projectId: seedProject, teamId: seedTeam };
    });
  }, [open, project?.id, availableProjects, availableTeams]);

  const utils = api.useUtils();
  const createMutation = api.virtualKeys.create.useMutation({
    onSuccess: async () => {
      await utils.virtualKeys.list.invalidate({ organizationId });
    },
  });
  const orgProvidersQuery = api.modelProvider.listAllForOrganizationForFrontend.useQuery(
    { organizationId },
    { enabled: open && !!organizationId },
  );
  const policiesQuery = api.routingPolicy.list.useQuery(
    { organizationId },
    { enabled: open && !!organizationId },
  );
  // Lazily provisions the caller's personal workspace, so Personal
  // ownership works even for users who predate personal workspaces.
  const personalContextQuery = api.user.personalContext.useQuery(
    { organizationId },
    { enabled: open && !!organizationId && ownership.kind === "PERSONAL" },
  );
  const personalProjectId = personalContextQuery.data?.workspace.project.id ?? null;

  const providers = (orgProvidersQuery.data?.providers ?? []) as OrgModelProvider[];
  const policies = (policiesQuery.data ?? []) as Array<{
    id: string;
    name: string;
  }>;
  const tagsNotice = tagsBeyondLimitsNotice(tagsCsv);

  const ownershipCtx = {
    organizationId,
    organizationName: organization?.name,
    availableTeams,
    availableProjects,
    personalProjectId,
  };

  const scopes = useMemo(
    () => ownershipToScopes(ownership, { organizationId, personalProjectId }) ?? [],
    [ownership, organizationId, personalProjectId],
  );
  const eligible = useMemo(
    () =>
      resolveEligible({
        scopes,
        providers,
        hierarchy: buildScopeHierarchy(availableProjects, organizationId),
      }),
    [scopes, providers, availableProjects, organizationId],
  );

  // Resolved on every render rather than at submit, because the block
  // states the date back to the reader as they pick it.
  const expiresAt = resolveExpiresAt({
    preset: expiration.preset,
    customDate: expiration.customDate,
  });

  const reset = () => {
    setName("");
    setDescription("");
    setTagsCsv("");
    setOwnership({
      kind: "PROJECT",
      projectId: null,
      teamId: null,
      traceProjectId: null,
    });
    setBudget(EMPTY_BUDGET);
    setProviderAccess(ALL_PROVIDERS);
    setRouting(ROUTING_NONE);
    setExpiration(NEVER_EXPIRES);
    setExpiryFieldError(null);
  };

  const handleClose = () => {
    if (createMutation.isPending) return;
    reset();
    onOpenChange(false);
  };

  const cannotIssueReason = (() => {
    if (!name) return "Name is required.";
    const ownershipReason = ownershipIncompleteReason(ownership, {
      personalProjectId,
    });
    if (ownershipReason) return ownershipReason;
    const budgetReason = budgetInvalidReason(budget);
    if (budgetReason) return budgetReason;
    // An explicit provider selection cannot be validated against a list
    // that has not arrived; creating now would persist an allowlist
    // filtered against nothing.
    if (orgProvidersQuery.isLoading) {
      return "Loading providers…";
    }
    const providerReason = providerAccessInvalidReason(providerAccess, eligible);
    if (providerReason) return providerReason;
    return expiryIncompleteReason({ preset: expiration.preset, expiresAt });
  })();

  const handleSubmit = async () => {
    if (cannotIssueReason) {
      toaster.create({ title: cannotIssueReason, type: "error" });
      return;
    }
    setExpiryFieldError(null);
    try {
      const tags = parseTagsCsv(tagsCsv);
      const access = providerAccessToConfig(providerAccess, eligible);
      const result = await createMutation.mutateAsync({
        organizationId,
        name,
        description: description || undefined,
        principalUserId:
          ownership.kind === "PERSONAL" ? (session.data?.user?.id ?? null) : null,
        scopes,
        traceProjectId: ownershipTraceProjectId(ownership),
        routingMode: routing.mode,
        routingPolicyId: routing.mode === "POLICY" ? routing.policyId : null,
        ...(expiresAt ? { expiresAt } : {}),
        budget: budget.limitUsd.trim()
          ? {
              limitUsd: budget.limitUsd.trim(),
              window: budget.window,
            }
          : null,
        config: {
          providersAllowed: access.providersAllowed,
          modelsAllowed: access.modelsAllowed,
          ...(tags.length > 0 ? { metadata: { tags } } : {}),
        },
      });
      onCreated({
        id: result.virtualKey.id,
        name: result.virtualKey.name,
        secret: result.secret,
        model: firstEligibleDefaultModel({
          scopes,
          providers,
          availableProjects,
          organizationId,
        }),
      });
      reset();
      onOpenChange(false);
    } catch (error) {
      // A rejected date belongs on the field the reader is still looking
      // at; everything else has nowhere better to go than the toast.
      const expiryError = expiryFieldErrorFrom(error);
      if (expiryError) {
        setExpiryFieldError(expiryError);
        return;
      }
      toaster.create({
        title: humanizeGatewayError(error, "Failed to create virtual key"),
        type: "error",
      });
    }
  };

  return (
    <Drawer.Root open={open} onOpenChange={() => handleClose()} placement="end" size="md">
      <Drawer.Content bg="bg">
        <Drawer.Header>
          <Drawer.Title>New virtual key</Drawer.Title>
          <Drawer.CloseTrigger />
        </Drawer.Header>
        <Drawer.Body>
          <VStack align="stretch" gap={4}>
            <Field.Root required>
              <Field.Label>
                Name
                <FieldInfoTooltip
                  description="Human-readable identifier shown in the list and audit log. Typical pattern: 'prod-openai' or 'codex-cli-team-ml'. Must be unique within the organization."
                  docHref="/ai-gateway/virtual-keys#creating-a-vk"
                />
              </Field.Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. codex-prod"
                maxLength={128}
                autoFocus
              />
            </Field.Root>
            <Field.Root>
              <Field.Label>Description</Field.Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional. Shown in the list."
              />
            </Field.Root>
            <Field.Root>
              <Field.Label>
                Tags
                <FieldInfoTooltip
                  description={VK_TAGS_FIELD_DESCRIPTION}
                  docHref="/ai-gateway/cache-control#cache-rules"
                  testId="vk-tags-info"
                />
              </Field.Label>
              <Input
                value={tagsCsv}
                onChange={(e) => setTagsCsv(e.target.value)}
                placeholder="e.g. tier=enterprise, team=ml"
                maxLength={TAGS_CSV_MAX_LENGTH}
              />
              {tagsNotice && (
                <Field.HelperText color="orange.600">{tagsNotice}</Field.HelperText>
              )}
            </Field.Root>

            <Separator />
            <VirtualKeyOwnershipSection
              value={ownership}
              onChange={setOwnership}
              ctx={ownershipCtx}
              canCreateShared={canCreateShared}
            />

            <Separator />
            <VirtualKeyBudgetSection
              value={budget}
              onChange={setBudget}
              organizationId={organizationId}
              scopes={scopes}
              principalUserId={
                ownership.kind === "PERSONAL" ? (session.data?.user?.id ?? null) : null
              }
            />

            <Separator />
            <VirtualKeyProviderAccessSection
              value={providerAccess}
              onChange={setProviderAccess}
              scopes={scopes}
              organizationId={organizationId}
              organizationName={organization?.name}
              availableTeams={availableTeams}
              availableProjects={availableProjects}
              providers={providers}
              isLoading={orgProvidersQuery.isLoading}
            />

            <Separator />
            <VirtualKeyRoutingSection
              value={routing}
              onChange={setRouting}
              policies={policies}
            />

            <Separator />
            <VirtualKeyExpirationSection
              value={expiration}
              onChange={setExpiration}
              fieldError={expiryFieldError}
            />
          </VStack>
        </Drawer.Body>
        <Drawer.Footer>
          <HStack width="full">
            {cannotIssueReason && (
              <Text fontSize="xs" color="fg.muted">
                {cannotIssueReason}
              </Text>
            )}
            <Spacer />
            <Button
              variant="ghost"
              onClick={handleClose}
              disabled={createMutation.isPending}
            >
              Cancel
            </Button>
            {cannotIssueReason ? (
              <Tooltip content={cannotIssueReason}>
                <Button colorPalette="orange" disabled>
                  Create
                </Button>
              </Tooltip>
            ) : (
              <Button
                colorPalette="orange"
                onClick={handleSubmit}
                loading={createMutation.isPending}
              >
                Create
              </Button>
            )}
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}
