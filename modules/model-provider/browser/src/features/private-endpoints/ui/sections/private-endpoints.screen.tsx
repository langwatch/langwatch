/**
 * `/settings/private-endpoints` (ADR-203): the organization's private endpoints, never their
 * addresses, and the hostnames bound to them.
 * Spec: specs/security/org-private-model-endpoints.feature.
 */
import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import { ListPage } from "@langwatch/design-system/list-page";
import { ListTable } from "@langwatch/design-system/list-table";
import { Badge, Button, Code, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import type {
  OrganizationPrivateModelEndpoint,
  PrivateModelEndpointBinding,
} from "@langwatch/model-provider-contract";
import { Network, Plus } from "lucide-react";
import { useState } from "react";

import { useModelProviderHost } from "../../../../model/model-provider-host.ts";
import { usePrivateEndpointBindings } from "../../behavior/use-private-endpoint-bindings.ts";
import {
  bindingFieldErrors,
  PRIVATE_ENDPOINT_STATUS_LABELS,
  type BindingFieldErrors,
} from "../../model/private-endpoint-bindings.ts";
import { BindingDialog, type BindingDraft } from "../blocks/binding-dialog.tsx";

/** The dialog that is open: adding to an endpoint, or changing one binding. */
type Editing =
  | { kind: "add"; initial: BindingDraft }
  | { kind: "change"; bindingId: string; initial: BindingDraft };

const MODEL_PROVIDERS_NEXT = {
  kind: "setting",
  label: "Model providers",
  href: "/settings/model-providers",
} as const;

export default function PrivateEndpointsScreen() {
  const host = useModelProviderHost();
  const organizationId = host.scope().organizationId ?? "";
  const { endpoints, bind, rebind, unbind } = usePrivateEndpointBindings({ organizationId });
  const [editing, setEditing] = useState<Editing | null>(null);
  const [errors, setErrors] = useState<BindingFieldErrors>({});
  const [removing, setRemoving] = useState<PrivateModelEndpointBinding | null>(null);

  const rows = endpoints.data ?? [];

  const open = (next: Editing) => {
    setErrors({});
    setEditing(next);
  };

  const onRefused = (fallbackTitle: string) => (error: unknown) => {
    const refused = bindingFieldErrors(error);
    if (refused.hostname) {
      setErrors(refused);
      return;
    }
    host.failed({ error, fallbackTitle });
  };

  const save = (draft: BindingDraft) => {
    if (!editing) return;
    const done = () => {
      host.succeeded({ title: "Hostname saved" });
      setEditing(null);
    };
    if (editing.kind === "add") {
      bind.mutate(
        { organizationId, endpointId: draft.endpointId, hostname: draft.hostname },
        { onSuccess: done, onError: onRefused("Couldn't add the hostname") },
      );
      return;
    }
    rebind.mutate(
      {
        organizationId,
        bindingId: editing.bindingId,
        endpointId: draft.endpointId,
        hostname: draft.hostname,
      },
      { onSuccess: done, onError: onRefused("Couldn't change the hostname") },
    );
  };

  const remove = () => {
    if (!removing) return;
    unbind.mutate(
      { organizationId, bindingId: removing.id },
      {
        onSuccess: () => {
          host.succeeded({ title: "Hostname removed" });
          setRemoving(null);
        },
        onError: (error) => host.failed({ error, fallbackTitle: "Couldn't remove the hostname" }),
      },
    );
  };

  const shared = {
    title: "Private endpoints",
    description:
      "Point your own hostnames at the private endpoints LangWatch set up for your organization.",
  };

  const table = (
    <ListTable scroll="x" scrollLabel="Private endpoints">
      <ListTable.Header>
        <ListTable.Row>
          <ListTable.ColumnHeader>Name</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Region</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Status</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Hostnames</ListTable.ColumnHeader>
          <ListTable.ActionHeader />
        </ListTable.Row>
      </ListTable.Header>
      <ListTable.Body>
        {rows.map((endpoint) => (
          <EndpointRow
            key={endpoint.id}
            endpoint={endpoint}
            onAdd={() => open({ kind: "add", initial: { endpointId: endpoint.id, hostname: "" } })}
            onChange={(binding) =>
              open({
                kind: "change",
                bindingId: binding.id,
                initial: { endpointId: binding.endpointId, hostname: binding.hostname },
              })
            }
            onRemove={setRemoving}
          />
        ))}
      </ListTable.Body>
    </ListTable>
  );

  return (
    <>
      {!endpoints.isLoading && rows.length === 0 ? (
        <ListPage
          {...shared}
          state="empty"
          empty={{
            title: "No private endpoints yet",
            description:
              "LangWatch staff set up private endpoints on request, for a model gateway inside your own network. Contact us to set one up.",
            icon: <Network size={24} />,
            next: [MODEL_PROVIDERS_NEXT],
          }}
        >
          {table}
        </ListPage>
      ) : (
        <ListPage {...shared} state={endpoints.isLoading ? "loading" : "ready"}>
          {table}
        </ListPage>
      )}

      <BindingDialog
        open={!!editing}
        title={editing?.kind === "change" ? "Change hostname" : "Add hostname"}
        submitLabel={editing?.kind === "change" ? "Save" : "Add"}
        endpoints={rows}
        initial={editing?.initial ?? EMPTY_DRAFT}
        errors={errors}
        loading={bind.isPending || rebind.isPending}
        onSubmit={save}
        onClose={() => setEditing(null)}
      />

      <ConfirmDialog
        open={!!removing}
        title="Remove hostname?"
        description={`Model calls to ${removing?.hostname ?? "this hostname"} stop reaching your private endpoint.`}
        confirmLabel="Remove"
        loading={unbind.isPending}
        onConfirm={remove}
        onClose={() => setRemoving(null)}
      />
    </>
  );
}

const EMPTY_DRAFT: BindingDraft = { endpointId: "", hostname: "" };

function EndpointRow({
  endpoint,
  onAdd,
  onChange,
  onRemove,
}: {
  endpoint: OrganizationPrivateModelEndpoint;
  onAdd: () => void;
  onChange: (binding: PrivateModelEndpointBinding) => void;
  onRemove: (binding: PrivateModelEndpointBinding) => void;
}) {
  return (
    <ListTable.Row>
      <ListTable.Cell>{endpoint.name}</ListTable.Cell>
      <ListTable.Cell>{endpoint.region}</ListTable.Cell>
      <ListTable.Cell>
        <Badge colorPalette={endpoint.status === "in_use" ? "green" : "gray"}>
          {PRIVATE_ENDPOINT_STATUS_LABELS[endpoint.status]}
        </Badge>
      </ListTable.Cell>
      <ListTable.Cell>
        {endpoint.bindings.length === 0 ? (
          <Text textStyle="sm" color="fg.muted">
            No hostnames
          </Text>
        ) : (
          <VStack align="start" gap={1}>
            {endpoint.bindings.map((binding) => (
              <HStack key={binding.id} gap={2}>
                <Code>{binding.hostname}</Code>
                <Button
                  size="xs"
                  variant="ghost"
                  aria-label={`Change ${binding.hostname}`}
                  onClick={() => onChange(binding)}
                >
                  Change
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  aria-label={`Remove ${binding.hostname}`}
                  onClick={() => onRemove(binding)}
                >
                  Remove
                </Button>
              </HStack>
            ))}
          </VStack>
        )}
      </ListTable.Cell>
      <ListTable.ActionCell>
        <Button
          size="xs"
          variant="outline"
          aria-label={`Add a hostname to ${endpoint.name}`}
          onClick={onAdd}
        >
          <Plus size={14} />
          Add hostname
        </Button>
      </ListTable.ActionCell>
    </ListTable.Row>
  );
}
