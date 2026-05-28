import {
  Box,
  Button,
  Field,
  HStack,
  Input,
  NativeSelect,
  Separator,
  Spacer,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { useEffect, useMemo, useState } from "react";

import { Drawer } from "~/components/ui/drawer";
import { Tooltip } from "~/components/ui/tooltip";
import { toaster } from "~/components/ui/toaster";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

import {
  ConfigureModelProvidersLink,
  EligibleModelProvidersPreview,
  EligibleModelProvidersSummary,
} from "./EligibleModelProvidersPreview";
import { FieldInfoTooltip } from "./FieldInfoTooltip";
import {
  VirtualKeyScopePicker,
  type VirtualKeyScopeEntry,
} from "./VirtualKeyScopePicker";

type VirtualKeyCreateDrawerProps = {
  organizationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (result: { id: string; name: string; secret: string }) => void;
};

export function VirtualKeyCreateDrawer({
  organizationId,
  open,
  onOpenChange,
  onCreated,
}: VirtualKeyCreateDrawerProps) {
  const { organization, team, project } = useOrganizationTeamProject();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tagsCsv, setTagsCsv] = useState("");
  const [scopes, setScopes] = useState<VirtualKeyScopeEntry[]>([]);
  const [routingPolicyId, setRoutingPolicyId] = useState<string>("");

  const availableTeams = useMemo(
    () =>
      organization?.teams?.map((t) => ({ id: t.id, name: t.name })) ?? [],
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

  // Seed the picker with the narrowest scope the user is currently in:
  // project beats team beats org. Mirrors the ModelProvider create flow.
  useEffect(() => {
    if (!open || scopes.length > 0) return;
    const seed: VirtualKeyScopeEntry | null = project?.id
      ? { scopeType: "PROJECT", scopeId: project.id }
      : team?.id
      ? { scopeType: "TEAM", scopeId: team.id }
      : organizationId
      ? { scopeType: "ORGANIZATION", scopeId: organizationId }
      : null;
    if (seed) setScopes([seed]);
  }, [open, scopes.length, project?.id, team?.id, organizationId]);

  const utils = api.useContext();
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

  const reset = () => {
    setName("");
    setDescription("");
    setTagsCsv("");
    setScopes([]);
    setRoutingPolicyId("");
  };

  const handleClose = () => {
    if (createMutation.isPending) return;
    reset();
    onOpenChange(false);
  };

  const handleSubmit = async () => {
    if (!name) {
      toaster.create({ title: "Name is required", type: "error" });
      return;
    }
    if (scopes.length === 0) {
      toaster.create({
        title: "Pick at least one scope for this key",
        type: "error",
      });
      return;
    }
    try {
      const tags = tagsCsv
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
      const result = await createMutation.mutateAsync({
        organizationId,
        name,
        description: description || undefined,
        scopes,
        routingPolicyId: routingPolicyId ? routingPolicyId : null,
        config: tags.length > 0 ? { metadata: { tags } } : undefined,
      });
      onCreated({
        id: result.virtualKey.id,
        name: result.virtualKey.name,
        secret: result.secret,
      });
      reset();
      onOpenChange(false);
    } catch (error) {
      toaster.create({
        title:
          error instanceof Error ? error.message : "Failed to create virtual key",
        type: "error",
        error: error,
      });
    }
  };

  const providers = orgProvidersQuery.data?.providers ?? [];
  const policies = policiesQuery.data ?? [];

  const cannotIssueReason = (() => {
    if (!name) return "Name is required.";
    if (scopes.length === 0) return "Pick at least one scope.";
    return null;
  })();

  return (
    <Drawer.Root
      open={open}
      onOpenChange={() => handleClose()}
      placement="end"
      size="md"
    >
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
                  description="Comma-separated tags attached to this VK. Cache-control rules match VKs on tags using AND-subset semantics — a rule matcher of ['tier=enterprise'] fires for any VK carrying that tag."
                  docHref="/ai-gateway/cache-control#cache-rules"
                />
              </Field.Label>
              <Input
                value={tagsCsv}
                onChange={(e) => setTagsCsv(e.target.value)}
                placeholder="e.g. tier=enterprise, team=ml"
              />
              <Field.HelperText>
                Comma-separated. Cache-control rules match VKs on tags as
                AND-subset.
              </Field.HelperText>
            </Field.Root>
            <Separator />

            <VirtualKeyScopePicker
              scopes={scopes}
              onScopesChange={setScopes}
              organizationId={organizationId}
              organizationName={organization?.name}
              teamId={team?.id}
              teamName={team?.name}
              projectId={project?.id}
              projectName={project?.name}
              availableTeams={availableTeams}
              availableProjects={availableProjects}
              currentOrganizationId={organizationId}
              currentTeamId={team?.id}
              currentProjectId={project?.id}
            />
            <EligibleModelProvidersSummary
              scopes={scopes}
              organizationId={organizationId}
              organizationName={organization?.name}
              availableTeams={availableTeams}
              availableProjects={availableProjects}
              isLoading={orgProvidersQuery.isLoading}
              providers={providers as any}
            />

            <Box>
              <HStack mb={1.5} alignItems="center" gap={2}>
                <ConfigureModelProvidersLink scopes={scopes} />
                <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
                  Eligible model providers
                </Text>
              </HStack>
              <EligibleModelProvidersPreview
                scopes={scopes}
                organizationId={organizationId}
                organizationName={organization?.name}
                availableTeams={availableTeams}
                availableProjects={availableProjects}
                isLoading={orgProvidersQuery.isLoading}
                providers={providers as any}
              />
            </Box>

            <Field.Root>
              <Field.Label>
                Routing policy (optional)
                <FieldInfoTooltip
                  description="Force this VK to use a specific ordered set of ModelProviders instead of the scope-cascade fallback. Useful for compliance lanes (e.g. 'only EU providers') or cost lanes ('prefer cheapest tier first')."
                  docHref="/ai-gateway/routing-policies"
                />
              </Field.Label>
              <NativeSelect.Root size="sm">
                <NativeSelect.Field
                  value={routingPolicyId}
                  onChange={(e) => setRoutingPolicyId(e.target.value)}
                >
                  <option value="">
                    Default — fall back to all eligible providers
                  </option>
                  {policies.map((p: any) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </NativeSelect.Field>
              </NativeSelect.Root>
              <Field.HelperText>
                Default cascade tries every eligible provider in fallback
                priority order. Pick a routing policy to constrain the set
                further.
              </Field.HelperText>
            </Field.Root>
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

