/**
 * Staff register, change and remove an organization's private endpoints (ADR-203). Only staff see
 * the addresses; the organization binds its own hostnames in settings.
 */
import { Dialog } from "@langwatch/design-system/dialog";
import {
  Badge,
  Button,
  Field,
  HStack,
  Input,
  Spacer,
  Text,
  Textarea,
  VStack,
} from "@langwatch/design-system/primitives";
import type { StaffPrivateModelEndpoint } from "@langwatch/model-provider-contract";
import { useState } from "react";

import { api } from "../../../../behavior/ops-api.ts";
import { useOpsToaster, useShowErrorToast } from "../../../../behavior/ops-feedback.ts";
import { useOpsHost } from "../../../../model/ops-host.ts";
import { ConfirmDialog } from "../../../../ui/elements/ops-confirm-dialog.tsx";
import {
  EMPTY_PRIVATE_ENDPOINT_FORM,
  privateEndpointFormOf,
  privateEndpointValues,
  serverRefusedPrivateEndpointFields,
  type PrivateEndpointField,
  type PrivateEndpointFieldErrors,
  type PrivateEndpointForm,
} from "../../model/private-endpoint-form.ts";
import { SectionHeading } from "../elements/admin-cells.tsx";

/** The form that is open: a new endpoint, or one being changed. */
type Editing = { endpointId: string | null; form: PrivateEndpointForm };

const FORM_ID = "ops-private-endpoint-form";

export function PrivateEndpointsSection({ organizationId }: { organizationId: string }) {
  const canManage = useOpsHost().isOpsAdmin();
  const toaster = useOpsToaster();
  const showErrorToast = useShowErrorToast();
  const utils = api.useUtils();
  const endpoints = api.privateModelEndpoint.listForStaff.useQuery({ organizationId });
  const refresh = () => void utils.privateModelEndpoint.listForStaff.invalidate({ organizationId });
  const register = api.privateModelEndpoint.register.useMutation({ onSuccess: refresh });
  const update = api.privateModelEndpoint.update.useMutation({ onSuccess: refresh });
  const remove = api.privateModelEndpoint.remove.useMutation({ onSuccess: refresh });

  const [editing, setEditing] = useState<Editing | null>(null);
  const [errors, setErrors] = useState<PrivateEndpointFieldErrors>({});
  const [removing, setRemoving] = useState<StaffPrivateModelEndpoint | null>(null);

  const open = (next: Editing) => {
    setErrors({});
    setEditing(next);
  };

  const setField = (field: PrivateEndpointField, value: string) => {
    setEditing((prev) => (prev ? { ...prev, form: { ...prev.form, [field]: value } } : prev));
    setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  };

  const onRefused = (fallbackTitle: string) => (error: unknown) => {
    const refused = serverRefusedPrivateEndpointFields(error);
    if (Object.keys(refused).length > 0) {
      setErrors(refused);
      return;
    }
    showErrorToast({ error, fallbackTitle });
  };

  const save = () => {
    if (!editing) return;
    const parsed = privateEndpointValues(editing.form);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    const done = (title: string) => () => {
      toaster.create({ title, type: "success", duration: 3000 });
      setEditing(null);
    };
    if (editing.endpointId === null) {
      register.mutate(
        { organizationId, ...parsed.values },
        {
          onSuccess: done("Private endpoint registered"),
          onError: onRefused("Couldn't register the private endpoint"),
        },
      );
      return;
    }
    update.mutate(
      { organizationId, endpointId: editing.endpointId, ...parsed.values },
      {
        onSuccess: done("Private endpoint updated"),
        onError: onRefused("Couldn't update the private endpoint"),
      },
    );
  };

  const confirmRemove = () => {
    if (!removing) return;
    remove.mutate(
      { organizationId, endpointId: removing.id },
      {
        onSuccess: () => {
          toaster.create({ title: "Private endpoint removed", type: "success", duration: 3000 });
          setRemoving(null);
        },
        onError: (error) =>
          showErrorToast({ error, fallbackTitle: "Couldn't remove the private endpoint" }),
      },
    );
  };

  return (
    <VStack align="stretch" gap={2}>
      <HStack>
        <SectionHeading>Private endpoints</SectionHeading>
        <Spacer />
        {canManage && (
          <Button
            size="xs"
            variant="outline"
            onClick={() => open({ endpointId: null, form: EMPTY_PRIVATE_ENDPOINT_FORM })}
          >
            Register endpoint
          </Button>
        )}
      </HStack>
      <EndpointList
        isLoading={endpoints.isLoading}
        endpoints={endpoints.data}
        canManage={canManage}
        onEdit={(endpoint) =>
          open({ endpointId: endpoint.id, form: privateEndpointFormOf(endpoint) })
        }
        onRemove={setRemoving}
      />

      <Dialog
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.endpointId ? "Edit private endpoint" : "Register private endpoint"}
        formId={FORM_ID}
        onSubmit={save}
        busy={register.isPending || update.isPending}
        primaryAction={{
          label: editing?.endpointId ? "Save" : "Register",
          type: "submit",
          loading: register.isPending || update.isPending,
        }}
      >
        {editing && <EndpointFields form={editing.form} errors={errors} setField={setField} />}
      </Dialog>

      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={confirmRemove}
        title="Remove private endpoint?"
        description={`This removes ${removing?.name ?? "the endpoint"} and every hostname the organization bound to it. Their model calls stop reaching it.`}
        isLoading={remove.isPending}
      />
    </VStack>
  );
}

function EndpointList({
  isLoading,
  endpoints,
  canManage,
  onEdit,
  onRemove,
}: {
  isLoading: boolean;
  endpoints: readonly StaffPrivateModelEndpoint[] | undefined;
  canManage: boolean;
  onEdit: (endpoint: StaffPrivateModelEndpoint) => void;
  onRemove: (endpoint: StaffPrivateModelEndpoint) => void;
}) {
  if (isLoading) {
    return (
      <Text fontSize="sm" color="fg.muted">
        Loading private endpoints…
      </Text>
    );
  }
  if (!endpoints) {
    return (
      <Text fontSize="sm" color="fg.error">
        The private endpoints could not be loaded.
      </Text>
    );
  }
  if (endpoints.length === 0) {
    return (
      <Text fontSize="sm" color="fg.muted">
        No private endpoints. Register one once its PrivateLink endpoint exists.
      </Text>
    );
  }
  return (
    <VStack align="stretch" gap={3}>
      {endpoints.map((endpoint) => (
        <VStack
          key={endpoint.id}
          align="stretch"
          gap={1}
          borderWidth="1px"
          borderColor="border.muted"
          borderRadius="md"
          padding={3}
          data-testid="ops-private-endpoint"
        >
          <HStack>
            <Text fontSize="sm" fontWeight="medium">
              {endpoint.name}
            </Text>
            <Text fontSize="sm" color="fg.muted">
              {endpoint.region}
            </Text>
            <Badge colorPalette={endpoint.status === "in_use" ? "green" : "gray"}>
              {endpoint.status === "in_use" ? "In use" : "Unbound"}
            </Badge>
            <Spacer />
            {canManage && (
              <>
                <Button size="xs" variant="ghost" onClick={() => onEdit(endpoint)}>
                  Edit
                </Button>
                <Button size="xs" variant="ghost" onClick={() => onRemove(endpoint)}>
                  Remove
                </Button>
              </>
            )}
          </HStack>
          <Text fontSize="xs" fontFamily="mono">
            {endpoint.addresses.join(", ")} on port {endpoint.port}
          </Text>
          <Text fontSize="xs" color="fg.muted">
            {endpoint.bindings.length === 0
              ? "No hostnames bound"
              : `Hostnames: ${endpoint.bindings.map((binding) => binding.hostname).join(", ")}`}
          </Text>
        </VStack>
      ))}
    </VStack>
  );
}

function EndpointFields({
  form,
  errors,
  setField,
}: {
  form: PrivateEndpointForm;
  errors: PrivateEndpointFieldErrors;
  setField: (field: PrivateEndpointField, value: string) => void;
}) {
  return (
    <VStack gap={4} align="stretch">
      <Field.Root invalid={!!errors.name}>
        <Field.Label>Name</Field.Label>
        <Input
          value={form.name}
          onChange={(e) => setField("name", e.target.value)}
          placeholder="Inference"
        />
        {errors.name && <Field.ErrorText>{errors.name}</Field.ErrorText>}
      </Field.Root>
      <Field.Root invalid={!!errors.region}>
        <Field.Label>Region</Field.Label>
        <Input
          value={form.region}
          onChange={(e) => setField("region", e.target.value)}
          placeholder="eu-west-1"
        />
        {errors.region && <Field.ErrorText>{errors.region}</Field.ErrorText>}
      </Field.Root>
      <Field.Root invalid={!!errors.addresses}>
        <Field.Label>Addresses</Field.Label>
        <Textarea
          rows={3}
          value={form.addresses}
          onChange={(e) => setField("addresses", e.target.value)}
          placeholder={"10.20.1.21\n10.20.2.34"}
          fontFamily="mono"
          fontSize="xs"
        />
        {errors.addresses && <Field.ErrorText>{errors.addresses}</Field.ErrorText>}
        <Field.HelperText>
          The private addresses of the endpoint's network interfaces. Separate them with commas or
          new lines.
        </Field.HelperText>
      </Field.Root>
      <Field.Root invalid={!!errors.port}>
        <Field.Label>Port</Field.Label>
        <Input
          type="number"
          min={1}
          max={65535}
          step={1}
          value={form.port}
          onChange={(e) => setField("port", e.target.value)}
        />
        {errors.port && <Field.ErrorText>{errors.port}</Field.ErrorText>}
      </Field.Root>
    </VStack>
  );
}
