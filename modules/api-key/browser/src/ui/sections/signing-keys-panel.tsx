/**
 * A project's braid signing keys, lent to the Braids page by `SigningKeysPanelToken`: each key's
 * status and signed spans over 24 hours; create, rotate and revoke, each confirmed. A secret
 * lives only in panel state. Spec: modules/api-key/specs/signing-keys.feature
 */
import type { SigningKeysPanelProps } from "@langwatch/api-key-client";
import type { SigningKey } from "@langwatch/api-key-contract";
import type { WireOf } from "@langwatch/api/web";
import type { SnippetCopy } from "@langwatch/design-system/code-preview";
import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import { EmptyValue } from "@langwatch/design-system/empty-value";
import { FeatureIllustration } from "@langwatch/design-system/feature-illustration";
import { FeatureMark } from "@langwatch/design-system/feature-mark";
import { FormattedDate } from "@langwatch/design-system/formatted-date";
import { MoreVerticalIcon } from "@langwatch/design-system/icons";
import { ListTable } from "@langwatch/design-system/list-table";
import { Menu } from "@langwatch/design-system/menu";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { Badge, Button, HStack, Spacer, Text, VStack } from "@langwatch/design-system/primitives";
import { Key, Plus } from "lucide-react";
import { useState } from "react";

import { apiKeyApi } from "../../behavior/api-key-api.ts";
import { useApiKeyHost } from "../../model/api-key-host.ts";
import { isEnterprisePlanRefusal } from "../../model/signing-key-setup.ts";
import { CreateSigningKeyDialog } from "../blocks/create-signing-key-dialog.tsx";
import { type IssuedSecret, SigningKeySecretDialog } from "../blocks/signing-key-secret-dialog.tsx";

type SigningKeyRow = WireOf<SigningKey>;
type PendingAction = Readonly<{ kind: "rotate" | "revoke"; key: SigningKeyRow }>;

const COLUMNS = 6;
/** A mutation answer that may carry a secret is dropped from the client's cache at once. */
const NO_CACHE = { gcTime: 0 } as const;

function StatusBadge({ signingKey }: { signingKey: SigningKeyRow }) {
  if (signingKey.status === "active") {
    return (
      <Badge size="sm" colorPalette="green">
        Active
      </Badge>
    );
  }
  if (signingKey.status === "verifying" && signingKey.verifiesUntil) {
    return (
      <Badge size="sm" colorPalette="orange">
        Verifying until <FormattedDate value={signingKey.verifiesUntil} display="date" />
      </Badge>
    );
  }
  return (
    <Badge size="sm" colorPalette="red">
      Revoked
    </Badge>
  );
}

function SigningKeyTableRow({
  signingKey,
  onAction,
}: {
  signingKey: SigningKeyRow;
  onAction: (action: PendingAction) => void;
}) {
  return (
    <ListTable.Row data-testid={`signing-key-row-${signingKey.id}`}>
      <ListTable.Cell>
        <VStack gap={0} align="start">
          <Text fontWeight="semibold">{signingKey.name}</Text>
          <Text textStyle="caption" color="fg.muted" fontFamily="mono">
            lwsk_{signingKey.publicId}
          </Text>
        </VStack>
      </ListTable.Cell>
      <ListTable.Cell>
        <StatusBadge signingKey={signingKey} />
      </ListTable.Cell>
      <ListTable.Cell nowrap>
        <FormattedDate value={signingKey.createdAt} display="relative" />
      </ListTable.Cell>
      <ListTable.Cell nowrap>
        {signingKey.lastUsedAt ? (
          <FormattedDate value={signingKey.lastUsedAt} display="relative" />
        ) : (
          <EmptyValue label="Not used yet" />
        )}
      </ListTable.Cell>
      <ListTable.Cell nowrap>
        <VStack gap={0} align="start">
          <Text textStyle="sm">{signingKey.passed24h.toLocaleString()} passed</Text>
          <Text textStyle="sm" color={signingKey.failed24h > 0 ? "fg.error" : "fg.muted"}>
            {signingKey.failed24h.toLocaleString()} failed
          </Text>
        </VStack>
      </ListTable.Cell>
      <ListTable.ActionCell>
        {signingKey.status === "active" && (
          <Menu.Root>
            <Menu.Trigger asChild>
              <Button size="xs" variant="ghost" aria-label={`Actions for ${signingKey.name}`}>
                <MoreVerticalIcon size={14} />
              </Button>
            </Menu.Trigger>
            <Menu.Content>
              <Menu.Item
                value="rotate"
                onClick={() => onAction({ kind: "rotate", key: signingKey })}
              >
                Rotate
              </Menu.Item>
              <Menu.Item
                value="revoke"
                color="fg.error"
                onClick={() => onAction({ kind: "revoke", key: signingKey })}
              >
                Revoke
              </Menu.Item>
            </Menu.Content>
          </Menu.Root>
        )}
      </ListTable.ActionCell>
    </ListTable.Row>
  );
}

function EnterpriseUpsell() {
  return (
    <VStack gap={3} align="start" data-testid="signing-keys-upsell">
      <FeatureIllustration feature="braids" name="enterprise" />
      <HStack gap={2}>
        <FeatureMark feature="braids" variant="mono" size={16} />
        <Text fontWeight="semibold">Signing keys come with the Enterprise plan</Text>
      </HStack>
      <Text color="fg.muted">
        Upgrade to sign the tags on your calls, so projects that braid into this one can trust them.
      </Text>
    </VStack>
  );
}

export function SigningKeysPanel({ projectId }: SigningKeysPanelProps) {
  const host = useApiKeyHost();
  const utils = apiKeyApi.useUtils();
  const keys = apiKeyApi.signingKeys.list.useQuery({ projectId });
  const create = apiKeyApi.signingKeys.create.useMutation(NO_CACHE);
  const rotate = apiKeyApi.signingKeys.rotate.useMutation(NO_CACHE);
  const revoke = apiKeyApi.signingKeys.revoke.useMutation();

  const [creating, setCreating] = useState(false);
  const [createRound, setCreateRound] = useState(0);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [issued, setIssued] = useState<IssuedSecret | null>(null);
  const [needsEnterprise, setNeedsEnterprise] = useState(false);

  const refused = ({ error, fallbackTitle }: { error: unknown; fallbackTitle: string }) => {
    setCreating(false);
    setPending(null);
    if (isEnterprisePlanRefusal(error)) setNeedsEnterprise(true);
    else host.failed({ error, fallbackTitle });
  };
  const copy: SnippetCopy = ({ text, what }) =>
    host.copyToClipboard({
      text,
      succeeded: { title: "Copied", description: `${what} copied to clipboard` },
    });

  const onCreate = ({ name }: { name: string }) =>
    create.mutate(
      { projectId, name },
      {
        onSuccess: ({ signingKey, secret }) => {
          create.reset();
          setCreating(false);
          setCreateRound(createRound + 1);
          setIssued({ name: signingKey.name, secret, rotated: false });
          void utils.signingKeys.list.invalidate({ projectId });
        },
        onError: (error) => refused({ error, fallbackTitle: "Couldn't create the signing key" }),
      },
    );

  const onConfirm = (action: PendingAction) => {
    const input = { projectId, keyId: action.key.id };
    if (action.kind === "rotate") {
      rotate.mutate(input, {
        onSuccess: ({ secret }) => {
          rotate.reset();
          setPending(null);
          setIssued({ name: action.key.name, secret, rotated: true });
          void utils.signingKeys.list.invalidate({ projectId });
        },
        onError: (error) => refused({ error, fallbackTitle: "Couldn't rotate the signing key" }),
      });
      return;
    }
    revoke.mutate(input, {
      onSuccess: () => {
        setPending(null);
        host.succeeded({
          title: "Signing key revoked",
          description: "Spans signed with it stop being marked verified within a minute.",
        });
        void utils.signingKeys.list.invalidate({ projectId });
      },
      onError: (error) => refused({ error, fallbackTitle: "Couldn't revoke the signing key" }),
    });
  };

  const rows = keys.data ?? [];
  return (
    <VStack gap={4} align="stretch" data-testid="signing-keys-panel">
      <HStack gap={3}>
        <Text color="fg.muted">
          Sign the tags on this project&apos;s calls so projects that braid into it can trust them.
        </Text>
        <Spacer />
        <Button size="sm" onClick={() => setCreating(true)} data-testid="signing-key-new">
          <Plus size={14} />
          New signing key
        </Button>
      </HStack>

      {needsEnterprise && <EnterpriseUpsell />}

      {!keys.isLoading && rows.length === 0 ? (
        <NoDataInfoBlock
          title="No signing keys"
          description="Create one if this project calls other projects and wants to prove it."
          icon={<Key size={24} />}
          testId="signing-keys-empty"
        />
      ) : (
        <ListTable scroll="x" scrollLabel="Signing keys">
          <ListTable.Header>
            <ListTable.Row>
              <ListTable.ColumnHeader>Name</ListTable.ColumnHeader>
              <ListTable.ColumnHeader>Status</ListTable.ColumnHeader>
              <ListTable.ColumnHeader>Created</ListTable.ColumnHeader>
              <ListTable.ColumnHeader>Last used</ListTable.ColumnHeader>
              <ListTable.ColumnHeader>Signed spans, 24 hours</ListTable.ColumnHeader>
              <ListTable.ActionHeader />
            </ListTable.Row>
          </ListTable.Header>
          <ListTable.Body>
            {keys.isLoading && <ListTable.LoadingRows rows={2} columns={COLUMNS} />}
            {rows.map((signingKey) => (
              <SigningKeyTableRow
                key={signingKey.id}
                signingKey={signingKey}
                onAction={setPending}
              />
            ))}
          </ListTable.Body>
        </ListTable>
      )}

      <CreateSigningKeyDialog
        key={createRound}
        open={creating}
        creating={create.isPending}
        onClose={() => setCreating(false)}
        onCreate={onCreate}
      />
      <ConfirmDialog
        open={pending?.kind === "rotate"}
        onClose={() => setPending(null)}
        onConfirm={() => pending && onConfirm(pending)}
        title={`Rotate "${pending?.key.name ?? ""}"?`}
        confirmLabel="Rotate key"
        loading={rotate.isPending}
        description="You get a new key, shown once. The old one keeps verifying for 7 days, so you can deploy the new key without dropping signatures."
      />
      <ConfirmDialog
        open={pending?.kind === "revoke"}
        onClose={() => setPending(null)}
        onConfirm={() => pending && onConfirm(pending)}
        title={`Revoke "${pending?.key.name ?? ""}"?`}
        confirmLabel="Revoke key"
        tone="danger"
        loading={revoke.isPending}
        description="The key stops working at once. Spans signed with it stop being marked verified within a minute."
      />
      <SigningKeySecretDialog issued={issued} copy={copy} onClose={() => setIssued(null)} />
    </VStack>
  );
}
