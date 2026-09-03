import {
  Box,
  Button,
  Field,
  HStack,
  Input,
  Separator,
  Spinner,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { X } from "lucide-react";
import { useMemo } from "react";
import type { UseFormReturn } from "react-hook-form";

import { ProviderScopeChips } from "@langwatch/authz-web/surfaces/scope-picker";
import {
  ScopeChipPicker,
  type ScopeTriadEntry,
} from "@langwatch/authz-web/surfaces/scope-picker";
import { Checkbox } from "@langwatch/design-system/checkbox";
import { Drawer } from "@langwatch/design-system/drawer";
import { FieldInfoTooltip } from "@langwatch/design-system/field-info-tooltip";
import { useOrganizationTeamProject } from "../../../../behavior/gateway-session";
import type { ModelTier } from "../../model/model-tier-presets";

import { ModelNameMappingSection } from "../blocks/model-name-mapping-section";
import { ModelTiersSection } from "./model-tiers-section";
import type { ProviderCredentialOption } from "../../model/provider-credential-option";
import { ProviderCredentialPicker } from "../elements/provider-credential-picker";
import { RestrictionsSection } from "../blocks/restrictions-section";
import type { RoutingPolicyFormValues } from "../../model/routing-policy-form";
import { useRoutingPolicyDrawerForm } from "../../behavior/use-routing-policy-drawer-form";
import { useRoutingPolicyMutations } from "../../behavior/use-routing-policy-mutations";

/**
 * URL-routed shell for the routing-policy editor (see
 * dev/docs/best_practices/drawers.md). Every prop is a scalar that survives a
 * round trip through the address bar, and the policy being edited is fetched
 * here rather than threaded in, so a pasted link reopens the same policy.
 *
 * With no `policyId` this is the create flow; `seedScopeType` and
 * `seedScopeId` pre-select where the new policy applies.
 *
 * IT DOES NOT CLOSE ITSELF, which is the drawers doc's rule rather than a
 * consequence of where it lives: a target that reaches for `closeDrawer` clears
 * the navigator's whole stack and drops whoever opened it. So closing arrives
 * as a callback, and the composing application's registry adapter supplies the
 * navigator's own.
 */
export function RoutingPolicyDrawer({
  policyId,
  seedScopeType,
  seedScopeId,
  seedIsDefault,
  onClose,
}: {
  policyId?: string;
  seedScopeType?: string;
  seedScopeId?: string;
  seedIsDefault?: string;
  /** Puts the address back where it was before the drawer opened. */
  onClose: () => void;
}) {
  const { organization } = useOrganizationTeamProject();
  const organizationId = organization?.id ?? "";
  const isEditing = !!policyId;

  const seedScopes: ScopeTriadEntry[] = useMemo(() => {
    if (!seedScopeType) return [];
    const scopeType = seedScopeType.toUpperCase() as ScopeTriadEntry["scopeType"];
    const scopeId = scopeType === "ORGANIZATION" ? organizationId : seedScopeId;
    return scopeId ? [{ scopeType, scopeId }] : [];
  }, [seedScopeType, seedScopeId, organizationId]);

  const drawer = useRoutingPolicyDrawerForm({
    policyId: policyId ?? null,
    organizationId,
    organization,
    seedScopes,
    seedIsDefault: seedIsDefault === "true",
  });

  const { save, isSaving, saveError, clearSaveError } = useRoutingPolicyMutations({
    organizationId,
    onSaved: onClose,
  });

  const { values, problems } = drawer;
  const canSave =
    !!values.name.trim() &&
    values.scopes.length > 0 &&
    values.modelProviderIds.length > 0 &&
    problems.length === 0 &&
    !isSaving;

  const onSubmit = drawer.form.handleSubmit((formValues) =>
    save({ policyId: policyId ?? null, values: formValues }),
  );

  return (
    <Drawer.Root
      open={true}
      onOpenChange={({ open }) => {
        if (!open) onClose();
      }}
      placement="end"
      size="md"
    >
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>
            {isEditing ? "Edit routing policy" : "New routing policy"}
          </Drawer.Title>
          <Drawer.CloseTrigger />
        </Drawer.Header>
        <Drawer.Body>
          {isEditing && drawer.policyLoading ? (
            <HStack gap={2}>
              <Spinner size="sm" />
              <Text fontSize="sm" color="fg.muted">
                Loading the policy
              </Text>
            </HStack>
          ) : (
            <DrawerBody
              form={drawer.form}
              values={values}
              isEditing={isEditing}
              organizationId={organizationId}
              organizationName={organization?.name}
              availableTeams={drawer.availableTeams}
              availableProjects={drawer.availableProjects}
              scopesWithNames={drawer.scopesWithNames}
              providerOptions={drawer.providerOptions}
              providersLoading={drawer.providersLoading}
              boundProviderTypes={drawer.boundProviderTypes}
            />
          )}
        </Drawer.Body>
        <Drawer.Footer>
          <VStack align="stretch" gap={3} width="full">
            <Problems problems={problems} />
            {saveError && (
              <SaveError
                isEditing={isEditing}
                message={saveError}
                onDismiss={clearSaveError}
              />
            )}
            <HStack justifyContent="flex-end" width="full">
              <Button onClick={onSubmit} loading={isSaving} disabled={!canSave}>
                {isEditing ? "Save changes" : "Create policy"}
              </Button>
            </HStack>
          </VStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}

function DrawerBody({
  form,
  values,
  isEditing,
  organizationId,
  organizationName,
  availableTeams,
  availableProjects,
  scopesWithNames,
  providerOptions,
  providersLoading,
  boundProviderTypes,
}: {
  form: UseFormReturn<RoutingPolicyFormValues>;
  values: RoutingPolicyFormValues;
  isEditing: boolean;
  organizationId: string;
  organizationName?: string;
  availableTeams: Array<{ id: string; name: string }>;
  availableProjects: Array<{ id: string; name: string; teamId?: string }>;
  scopesWithNames: ScopeTriadEntry[];
  providerOptions: ProviderCredentialOption[];
  providersLoading: boolean;
  boundProviderTypes: string[];
}) {
  const { control, register, setValue } = form;

  return (
    <VStack align="stretch" gap={5}>
      <Field.Root required>
        <Field.Label>Name</Field.Label>
        <Input autoFocus placeholder="Developer default" {...register("name")} />
      </Field.Root>

      <Field.Root>
        <Field.Label>Description</Field.Label>
        <Textarea
          rows={2}
          placeholder="What this policy is for"
          {...register("description")}
        />
      </Field.Root>

      {!isEditing && (
        <Checkbox
          checked={values.isDefault}
          onChange={(event) => setValue("isDefault", event.target.checked)}
        >
          <Text fontSize="sm">Make this the default where it applies</Text>
        </Checkbox>
      )}

      <Separator />

      <Field.Root required>
        <Field.Label>Where it applies</Field.Label>
        {isEditing ? (
          <>
            <ProviderScopeChips scopes={scopesWithNames} />
            <Field.HelperText>
              Fixed once the policy exists. Create another policy to cover a different
              organization, team or project.
            </Field.HelperText>
          </>
        ) : (
          <ScopeChipPicker
            label=""
            value={values.scopes}
            onChange={(next) => setValue("scopes", next)}
            organizationId={organizationId}
            organizationName={organizationName}
            availableTeams={availableTeams}
            availableProjects={availableProjects}
            currentOrganizationId={organizationId}
          />
        )}
      </Field.Root>

      <Field.Root required>
        <Field.Label>
          Model providers, in order
          <FieldInfoTooltip
            description="The providers this policy routes through. The gateway tries the first one, and moves to the next when a request fails in a way another provider could answer. Reorder with the arrows on each row."
            docHref="/ai-gateway/governance/routing-policies"
          />
        </Field.Label>
        <ProviderCredentialPicker
          selectedIds={values.modelProviderIds}
          onChange={(next) => setValue("modelProviderIds", next)}
          available={providerOptions}
          loading={providersLoading}
          modelProvidersAdminPath="/settings/model-providers"
        />
      </Field.Root>

      <Separator />

      <ModelTiersSection
        control={control}
        organizationId={organizationId}
        boundProviderTypes={boundProviderTypes}
        onTierChange={(tier: ModelTier, modelId) => setValue(`tiers.${tier}`, modelId)}
        onDefaultModelChange={(modelId) => setValue("defaultModel", modelId)}
      />

      <Separator />

      <ModelNameMappingSection control={control} register={register} />

      <Separator />

      <RestrictionsSection control={control} register={register} />
    </VStack>
  );
}

/** Reasons the policy cannot be saved as it stands. */
function Problems({ problems }: { problems: string[] }) {
  if (problems.length === 0) return null;
  return (
    <VStack
      align="start"
      gap={1}
      borderWidth="1px"
      borderColor="orange.300"
      borderRadius="md"
      backgroundColor="orange.50"
      padding={3}
    >
      {problems.map((problem) => (
        <Text key={problem} fontSize="xs" color="orange.700">
          {problem}
        </Text>
      ))}
    </VStack>
  );
}

/**
 * A save failure is shown here rather than as a toast: the form that failed is
 * still on screen, and a toast racing the drawer overlay is how a rejected
 * save came to look like a no-op.
 */
function SaveError({
  isEditing,
  message,
  onDismiss,
}: {
  isEditing: boolean;
  message: string;
  onDismiss: () => void;
}) {
  return (
    <Box
      borderWidth="1px"
      borderColor="red.300"
      borderRadius="md"
      backgroundColor="red.50"
      padding={3}
    >
      <HStack alignItems="start" gap={2}>
        <VStack align="start" gap={0} flex={1} minWidth={0}>
          <Text fontSize="xs" fontWeight="semibold" color="red.700">
            {isEditing ? "Couldn't save the policy" : "Couldn't create the policy"}
          </Text>
          <Text fontSize="xs" color="red.700">
            {message}
          </Text>
        </VStack>
        <Button
          size="xs"
          variant="ghost"
          onClick={onDismiss}
          aria-label="Dismiss the error"
        >
          <X size={12} />
        </Button>
      </HStack>
    </Box>
  );
}
