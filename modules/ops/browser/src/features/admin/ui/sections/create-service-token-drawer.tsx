import { CopyButton } from "@langwatch/design-system/copy-button";
import { Drawer } from "@langwatch/design-system/drawer";
import { Field, HStack, Input, Text, VStack } from "@langwatch/design-system/primitives";
import { useEffect, useId, useState, type FormEvent } from "react";

import { useTestingLicenseTokenCommands } from "../../behavior/use-testing-license-token-commands.ts";
import {
  emptyServiceTokenDraft,
  MAX_SERVICE_TOKEN_DAYS,
  serviceTokenProblems,
  type ServiceTokenDraft,
} from "../../model/testing-license-token.ts";

/** Creates a CI token and shows it once: only a hash is stored, so closing this drawer loses
 * it; the fix is to create another and revoke this one. */
export function CreateServiceTokenDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<ServiceTokenDraft>(emptyServiceTokenDraft);
  const [created, setCreated] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const formId = useId();
  const commands = useTestingLicenseTokenCommands();

  useEffect(() => {
    if (!open) return;
    setDraft(emptyServiceTokenDraft());
    setCreated(null);
    setAttempted(false);
  }, [open]);

  const problems = attempted ? serviceTokenProblems(draft) : {};

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (commands.createServiceToken.isPending) return;
    if (Object.keys(serviceTokenProblems(draft)).length > 0) {
      setAttempted(true);
      return;
    }
    commands.createServiceToken.mutate(
      { name: draft.name.trim(), expiresInDays: Number(draft.expiresInDays) },
      { onSuccess: (result) => setCreated(result.token) },
    );
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="New service token"
      size="md"
      footer={
        created
          ? { cancel: { label: "Done", onClick: onClose } }
          : {
              cancel: { onClick: onClose },
              primaryAction: {
                label: "Create token",
                type: "submit",
                form: formId,
                loading: commands.createServiceToken.isPending,
              },
            }
      }
    >
      {created ? (
        <CreatedToken token={created} />
      ) : (
        <form id={formId} noValidate onSubmit={submit}>
          <VStack align="start" gap={4} width="full">
            <Field.Root invalid={problems.name !== undefined}>
              <Field.Label>Name</Field.Label>
              <Input
                aria-invalid={problems.name !== undefined || undefined}
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder="CI on main"
              />
              <Field.ErrorText>{problems.name}</Field.ErrorText>
            </Field.Root>
            <Field.Root invalid={problems.expiresInDays !== undefined}>
              <Field.Label>Expires in, in days</Field.Label>
              <Input
                type="number"
                min={1}
                max={MAX_SERVICE_TOKEN_DAYS}
                aria-invalid={problems.expiresInDays !== undefined || undefined}
                value={draft.expiresInDays}
                onChange={(event) => setDraft({ ...draft, expiresInDays: event.target.value })}
              />
              <Field.HelperText>At most {MAX_SERVICE_TOKEN_DAYS} days.</Field.HelperText>
              <Field.ErrorText>{problems.expiresInDays}</Field.ErrorText>
            </Field.Root>
          </VStack>
        </form>
      )}
    </Drawer>
  );
}

function CreatedToken({ token }: { token: string }) {
  return (
    <VStack align="start" gap={3} width="full">
      <Text fontWeight="medium">Service token</Text>
      <Text fontSize="sm" color="fg.muted">
        Copy it now and store it in your CI secrets. Only a hash of it is kept, so it cannot be
        shown again. If it is lost, create another and revoke this one.
      </Text>
      <HStack width="full">
        <Input
          readOnly
          value={token}
          fontFamily="mono"
          fontSize="sm"
          aria-label="Service token"
          onFocus={(event) => event.target.select()}
        />
        <CopyButton value={token} label="Service token" aria-label="Copy service token" />
      </HStack>
    </VStack>
  );
}
