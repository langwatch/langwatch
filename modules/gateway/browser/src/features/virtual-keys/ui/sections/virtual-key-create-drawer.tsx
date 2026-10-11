import { Banner, BannerAction } from "@langwatch/design-system/banner";
import { Drawer } from "@langwatch/design-system/drawer";
import { FieldInfoTooltip } from "@langwatch/design-system/field-info-tooltip";
import { Field, Input, Separator, Textarea, VStack } from "@langwatch/design-system/primitives";
import { useEffect, useMemo, useRef, useState } from "react";

import { api } from "../../../../behavior/gateway-api.ts";
import { type GatewayToaster, useGatewayToaster } from "../../../../behavior/gateway-feedback.ts";
import {
  useOrganizationTeamProject,
  useCurrentUser,
} from "../../../../behavior/gateway-session.ts";
import { humanizeGatewayError } from "../../../../model/gateway-error-copy.ts";
import { useGatewayHost } from "../../../../model/gateway-host.ts";
import {
  useRecordMintedKey,
  useVirtualKeyTourActions,
} from "../../behavior/use-virtual-key-tour.ts";
import {
  buildScopeHierarchy,
  firstEligibleDefaultModel,
  type OrgModelProvider,
  resolveEligible,
} from "../../model/eligible-model-providers.ts";
import {
  expiryFieldErrorFrom,
  expiryIncompleteReason,
  resolveExpiresAt,
} from "../../model/virtual-key-expiration.ts";
import { virtualKeyProjectOptions } from "../../model/virtual-key-project-options.ts";
import {
  TAGS_CSV_MAX_LENGTH,
  VK_TAGS_FIELD_DESCRIPTION,
  parseTagsCsv,
  tagsBeyondLimitsNotice,
} from "../../model/virtual-key-tags-field.ts";
import {
  ownershipIncompleteReason,
  ownershipToScopes,
  ownershipTraceProjectId,
  type VirtualKeyOwnership,
  VirtualKeyOwnershipSection,
} from "../blocks/virtual-key-ownership-section.tsx";
import {
  ALL_PROVIDERS,
  type ProviderAccessValue,
  providerAccessInvalidReason,
  providerAccessToConfig,
  VirtualKeyProviderAccessSection,
} from "../blocks/virtual-key-provider-access-section.tsx";
import {
  NEVER_EXPIRES,
  VirtualKeyExpirationSection,
  type VirtualKeyExpirationValue,
} from "../elements/virtual-key-expiration-section.tsx";
import {
  ROUTING_NONE,
  VirtualKeyRoutingSection,
  type VirtualKeyRoutingValue,
} from "../elements/virtual-key-routing-section.tsx";
import {
  budgetInvalidReason,
  EMPTY_BUDGET,
  VirtualKeyBudgetSection,
  type VirtualKeyBudgetValue,
} from "./virtual-key-budget-section.tsx";

type CreatedVirtualKey = { id: string; name: string; secret: string; model?: string };

type VirtualKeyCreateDrawerProps = {
  organizationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (result: CreatedVirtualKey) => void;
};

/** What is left to do once a key has been minted but the form is not yet out of the way. */
type PostMintRecovery = { kind: "handoff"; key: CreatedVirtualKey } | { kind: "close" };

/** On first open, own the key by the current project; a no-op seed keeps the state's identity. */
function seededOwnership(
  prev: VirtualKeyOwnership,
  input: {
    projectId: string | undefined;
    availableProjects: readonly { id: string }[];
    availableTeams: readonly { id: string }[];
  },
): VirtualKeyOwnership {
  if (prev.projectId ?? prev.teamId) return prev;
  // The current project only when a key may use it: an aggregate (ADR-177)
  // is not, so the first offered project stands in.
  const seedProject =
    input.availableProjects.find((option) => option.id === input.projectId)?.id ??
    input.availableProjects[0]?.id ??
    null;
  const seedTeam = input.availableTeams.length === 1 ? (input.availableTeams[0]?.id ?? null) : null;
  if (prev.projectId === seedProject && prev.teamId === seedTeam) {
    return prev;
  }
  return { ...prev, projectId: seedProject, teamId: seedTeam };
}

/** The first thing that keeps the key from being issued yet, in the order the form reads. */
function cannotIssueReasonFor(input: {
  name: string;
  ownership: VirtualKeyOwnership;
  personalProjectId: string | null;
  budget: VirtualKeyBudgetValue;
  providersLoading: boolean;
  providerAccess: ProviderAccessValue;
  eligible: ReturnType<typeof resolveEligible>;
  expiration: VirtualKeyExpirationValue;
  expiresAt: ReturnType<typeof resolveExpiresAt>;
}): ReturnType<typeof expiryIncompleteReason> | string {
  if (!input.name) return "Name is required.";
  const ownershipReason = ownershipIncompleteReason(input.ownership, {
    personalProjectId: input.personalProjectId,
  });
  if (ownershipReason) return ownershipReason;
  const budgetReason = budgetInvalidReason(input.budget);
  if (budgetReason) return budgetReason;
  // An explicit provider selection cannot be validated against a list
  // that has not arrived; creating now would persist an allowlist
  // filtered against nothing.
  if (input.providersLoading) {
    return "Loading providers…";
  }
  const providerReason = providerAccessInvalidReason(input.providerAccess, input.eligible);
  if (providerReason) return providerReason;
  return expiryIncompleteReason({ preset: input.expiration.preset, expiresAt: input.expiresAt });
}

type CreateVirtualKeyInput = Parameters<
  ReturnType<typeof api.virtualKeys.create.useMutation>["mutateAsync"]
>[0];

/** The form as the create call takes it: blanks left out, the budget only when a limit is set. */
function createVirtualKeyInput(form: {
  organizationId: string;
  name: string;
  description: string;
  tagsCsv: string;
  ownership: VirtualKeyOwnership;
  currentUserId: string | undefined;
  scopes: CreateVirtualKeyInput["scopes"];
  routing: VirtualKeyRoutingValue;
  expiresAt: ReturnType<typeof resolveExpiresAt>;
  budget: VirtualKeyBudgetValue;
  access: ReturnType<typeof providerAccessToConfig>;
  revealOnce: boolean;
}): CreateVirtualKeyInput {
  const tags = parseTagsCsv(form.tagsCsv);
  return {
    organizationId: form.organizationId,
    name: form.name,
    description: form.description || undefined,
    principalUserId: form.ownership.kind === "PERSONAL" ? (form.currentUserId ?? null) : null,
    scopes: form.scopes,
    traceProjectId: ownershipTraceProjectId(form.ownership),
    routingMode: form.routing.mode,
    routingPolicyId: form.routing.mode === "POLICY" ? form.routing.policyId : null,
    ...(form.expiresAt ? { expiresAt: form.expiresAt } : {}),
    budget: form.budget.limitUsd.trim()
      ? {
          limitUsd: form.budget.limitUsd.trim(),
          window: form.budget.window,
        }
      : null,
    config: {
      providersAllowed: form.access.providersAllowed,
      modelsAllowed: form.access.modelsAllowed,
      ...(tags.length > 0 ? { metadata: { tags } } : {}),
    },
    ...(form.revealOnce ? { revealOnce: true } : {}),
  };
}

/** A rejected date belongs on its field, where the reader is looking; the rest goes to a toast. */
function reportCreateFailure({
  error,
  toaster,
  setExpiryFieldError,
}: {
  error: unknown;
  toaster: GatewayToaster;
  setExpiryFieldError: (message: string) => void;
}) {
  const expiryError = expiryFieldErrorFrom(error);
  if (expiryError) {
    setExpiryFieldError(expiryError);
    return;
  }
  toaster.create({
    title: humanizeGatewayError(error, "Failed to create virtual key"),
    type: "error",
    error,
  });
}

/**
 * What happens once a key exists: the handoff to the secret reveal, then the form closing. A
 * failure of either is kept as a recovery that retries only that step, never the create. The lock
 * is held from the start of a submit until the key is out of the form's hands.
 */
function usePostMintRecovery({
  onCreated,
  onOpenChange,
  reset,
}: {
  onCreated: (result: CreatedVirtualKey) => void;
  onOpenChange: (open: boolean) => void;
  reset: () => void;
}) {
  const submitLockRef = useRef(false);
  const [recovery, setRecovery] = useState<PostMintRecovery | null>(null);

  const closeForm = () => {
    try {
      reset();
      onOpenChange(false);
    } catch {
      setRecovery({ kind: "close" });
      return;
    }
    setRecovery(null);
    submitLockRef.current = false;
  };

  const handOffKey = (key: CreatedVirtualKey) => {
    try {
      onCreated(key);
    } catch {
      setRecovery({ kind: "handoff", key });
      return;
    }
    closeForm();
  };

  return { recovery, submitLockRef, handOffKey, closeForm };
}

/** Says the key exists, and offers the one step left: showing it, or closing the form. */
function PostMintRecoveryBanner({
  recovery,
  onShowKey,
  onClose,
}: {
  recovery: PostMintRecovery;
  onShowKey: (key: CreatedVirtualKey) => void;
  onClose: () => void;
}) {
  if (recovery.kind === "handoff") {
    return (
      <Banner
        status="error"
        title="Virtual key created, but we couldn't finish opening it."
        data-testid="gateway-virtual-key-handoff-failed"
        action={<BannerAction onClick={() => onShowKey(recovery.key)}>Show key</BannerAction>}
      >
        Show the key to finish. You don't need to create another one.
      </Banner>
    );
  }
  return (
    <Banner
      status="error"
      title="Virtual key created, but we couldn't close this form."
      data-testid="gateway-virtual-key-close-failed"
      action={<BannerAction onClick={onClose}>Close</BannerAction>}
    >
      Close it to carry on. You don't need to create another one.
    </Banner>
  );
}

/** Create, held back with its reason until the form can issue, and for good once a key exists. */
/** A refused create focuses the name when it is the gap; any other reason is a toast. */
function refuseCreate(input: {
  reason: string;
  nameMissing: boolean;
  focusName: () => void;
  toast: (title: string) => void;
}): void {
  if (input.nameMissing) input.focusName();
  else input.toast(input.reason);
}

/** The footer says why a create was refused only once the reader has tried. */
function noteAfterAttempt(input: { attempted: boolean; reason: string | null | undefined }) {
  return input.attempted ? input.reason : void 0;
}

/** A key already created cannot be created again: the one genuine unavailability here. */
function mintedReason(minted: boolean): string | undefined {
  return minted ? "This key is already created." : void 0;
}

export function VirtualKeyCreateDrawer({
  organizationId,
  open,
  onOpenChange,
  onCreated,
}: VirtualKeyCreateDrawerProps) {
  const toaster = useGatewayToaster();
  const { organization, project } = useOrganizationTeamProject();
  const host = useGatewayHost();
  const currentUser = useCurrentUser();
  const [name, setName] = useState("");
  const [attempted, setAttempted] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const [description, setDescription] = useState("");
  const [tagsCsv, setTagsCsv] = useState("");
  const [ownership, setOwnership] = useState<VirtualKeyOwnership>({
    kind: "PROJECT",
    projectId: null,
    teamId: null,
    traceProjectId: null,
  });
  const [budget, setBudget] = useState<VirtualKeyBudgetValue>(EMPTY_BUDGET);
  const [providerAccess, setProviderAccess] = useState<ProviderAccessValue>(ALL_PROVIDERS);
  const [routing, setRouting] = useState<VirtualKeyRoutingValue>(ROUTING_NONE);
  const [expiration, setExpiration] = useState<VirtualKeyExpirationValue>(NEVER_EXPIRES);
  const [expiryFieldError, setExpiryFieldError] = useState<string | null>(null);

  const canCreateShared = host.hasPermission("virtualKeys:manage");

  const availableTeams = useMemo(
    () => organization?.teams?.map((t) => ({ id: t.id, name: t.name })) ?? [],
    [organization?.teams],
  );
  const availableProjects = useMemo(
    () => virtualKeyProjectOptions(organization?.teams),
    [organization?.teams],
  );

  // Seed ownership with the project the user is currently in (the
  // default shape of a key) the first time the drawer opens. The trace
  // project of an org- or team-owned key is deliberately NOT seeded:
  // where a shared key's traces and costs land is an explicit choice.
  useEffect(() => {
    if (!open) return;
    setOwnership((prev) =>
      seededOwnership(prev, { projectId: project?.id, availableProjects, availableTeams }),
    );
  }, [open, project?.id, availableProjects, availableTeams]);

  const utils = api.useUtils();
  const createMutation = api.virtualKeys.create.useMutation();
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
  const personalContextQuery = api.routingPolicy.personalContext.useQuery(
    { organizationId },
    { enabled: open && !!organizationId && ownership.kind === "PERSONAL" },
  );
  const personalProjectId = personalContextQuery.data?.workspace.project.id ?? null;

  const providers = useMemo(
    (): OrgModelProvider[] => orgProvidersQuery.data ?? [],
    [orgProvidersQuery.data],
  );
  const policies = (policiesQuery.data ?? []) as {
    id: string;
    name: string;
  }[];
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
    setAttempted(false);
  };

  const { recovery, submitLockRef, handOffKey, closeForm } = usePostMintRecovery({
    onCreated,
    onOpenChange,
    reset,
  });

  const handleClose = () => {
    if (recovery?.kind === "close") {
      closeForm();
      return;
    }
    if (createMutation.isPending || submitLockRef.current) return;
    reset();
    onOpenChange(false);
  };

  const cannotIssueReason = cannotIssueReasonFor({
    name,
    ownership,
    personalProjectId,
    budget,
    providersLoading: orgProvidersQuery.isLoading,
    providerAccess,
    eligible,
    expiration,
    expiresAt,
  });

  const recordMintedKey = useRecordMintedKey();

  const handleSubmit = async ({ revealOnce = false }: { revealOnce?: boolean } = {}) => {
    setAttempted(true);
    if (cannotIssueReason) {
      refuseCreate({
        reason: cannotIssueReason,
        nameMissing: !name,
        focusName: () => nameInput.current?.focus(),
        toast: (title) => toaster.create({ title, type: "error" }),
      });
      return;
    }
    if (submitLockRef.current) return;
    submitLockRef.current = true;
    setExpiryFieldError(null);
    const model = firstEligibleDefaultModel({
      scopes,
      providers,
      availableProjects,
      organizationId,
    });
    let result: Awaited<ReturnType<typeof createMutation.mutateAsync>>;
    try {
      result = await createMutation.mutateAsync(
        createVirtualKeyInput({
          organizationId,
          name,
          description,
          tagsCsv,
          ownership,
          currentUserId: currentUser?.id,
          scopes,
          routing,
          expiresAt,
          budget,
          access: providerAccessToConfig(providerAccess, eligible),
          revealOnce,
        }),
      );
    } catch (error) {
      submitLockRef.current = false;
      reportCreateFailure({ error, toaster, setExpiryFieldError });
      return;
    }
    // From here the key exists. Nothing below may read as a failed create or invite another one.
    const key: CreatedVirtualKey = {
      id: result.virtualKey.id,
      name: result.virtualKey.name,
      secret: result.secret,
      model,
    };
    // The list refreshes behind the handoff; a failed refresh costs a stale row, not the key.
    void (async () => utils.virtualKeys.list.invalidate({ organizationId }))().catch(
      () => undefined,
    );
    if (revealOnce) {
      await recordMintedKey({
        organizationId,
        name: key.name,
        revealId: result.revealId,
        preview: result.preview,
      }).catch(() => undefined);
    }
    handOffKey(key);
  };

  useVirtualKeyTourActions({ organizationId, setName, submit: handleSubmit });

  return (
    <Drawer
      open={open}
      onClose={handleClose}
      title="New virtual key"
      size="md"
      busy={createMutation.isPending || recovery?.kind === "handoff"}
      footer={{
        note: noteAfterAttempt({ attempted, reason: cannotIssueReason }),
        cancel: { label: "Cancel", onClick: handleClose },
        primaryAction: {
          label: "Create",
          loading: createMutation.isPending,
          disabledReason: mintedReason(recovery !== null),
          onClick: () => void handleSubmit(),
          "data-testid": "gateway-virtual-key-create-submit",
          "data-tour": "vk-create",
        },
      }}
    >
      {recovery && (
        <PostMintRecoveryBanner recovery={recovery} onShowKey={handOffKey} onClose={closeForm} />
      )}
      <VStack align="stretch" gap={4} inert={recovery ? true : undefined}>
        <Field.Root required invalid={attempted && !name}>
          <Field.Label>
            Name
            <FieldInfoTooltip
              description="A name to help you recognize this key in the list and audit log. For example, 'prod-openai' or 'codex-cli-team-ml'."
              docHref="/ai-gateway/virtual-keys#creating-a-vk"
            />
          </Field.Label>
          <Input
            ref={nameInput}
            data-testid="gateway-virtual-key-name"
            data-tour="vk-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. codex-prod"
            maxLength={128}
          />
          <Field.ErrorText>Name is required.</Field.ErrorText>
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
          {tagsNotice && <Field.HelperText color="orange.fg">{tagsNotice}</Field.HelperText>}
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
          principalUserId={ownership.kind === "PERSONAL" ? (currentUser?.id ?? null) : null}
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
        <VirtualKeyRoutingSection value={routing} onChange={setRouting} policies={policies} />

        <Separator />
        <VirtualKeyExpirationSection
          value={expiration}
          onChange={setExpiration}
          fieldError={expiryFieldError}
        />
      </VStack>
    </Drawer>
  );
}
