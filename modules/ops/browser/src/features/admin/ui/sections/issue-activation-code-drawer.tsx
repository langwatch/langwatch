import { Button, Field, HStack, Input, NativeSelect, Text, VStack } from "@chakra-ui/react";
import { Checkbox } from "@langwatch/design-system/checkbox";
import { Drawer } from "@langwatch/design-system/drawer";
import { addDays, nowInstant, toDate } from "@langwatch/time";
import { useEffect, useState } from "react";

import { useActivationCodeCommands } from "../../behavior/use-activation-code-commands.ts";
import { SERVICES, SERVICE_LABELS, type Service } from "../../model/license-terms.ts";
import { dateInputToISO } from "../elements/backoffice-cells.tsx";

type PlanType = "GROWTH" | "PRO" | "ENTERPRISE" | "CUSTOM";
const PLANS: PlanType[] = ["ENTERPRISE", "GROWTH", "PRO", "CUSTOM"];

/** A code is useful for a month; a license it mints runs for a year. */
const DEFAULT_CODE_DAYS = 30;
const DEFAULT_TERM_DAYS = 365;

function isoDaysFromNow(days: number): string {
  return addDays(toDate(nowInstant()), days).toISOString().slice(0, 10);
}

interface Draft {
  organizationId: string;
  organizationName: string;
  email: string;
  planType: PlanType;
  maxMembers: string;
  licenseTermDays: string;
  services: Service[];
  expiresOn: string;
  reusable: boolean;
}

// A code is the connected path: the license it mints syncs and refreshes on
// its own only while it names a hosted service, so every one starts included.
function emptyDraft(): Draft {
  return {
    organizationId: "",
    organizationName: "",
    email: "",
    planType: "ENTERPRISE",
    maxMembers: "25",
    licenseTermDays: String(DEFAULT_TERM_DAYS),
    services: [...SERVICES],
    expiresOn: isoDaysFromNow(DEFAULT_CODE_DAYS),
    reusable: false,
  };
}

function namesTheCustomer(draft: Draft): boolean {
  return Boolean(
    draft.organizationId.trim() && draft.organizationName.trim() && draft.email.trim(),
  );
}

/** Issues an activation code and shows it once: the registry holds only its
 * hash, so closing this drawer loses it — the fix is to issue another and
 * revoke this one. */
export function IssueActivationCodeDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [issued, setIssued] = useState<string | null>(null);
  const commands = useActivationCodeCommands();

  useEffect(() => {
    if (!open) return;
    setDraft(emptyDraft());
    setIssued(null);
  }, [open]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  return (
    <Drawer.Root open={open} onOpenChange={({ open: next }) => !next && onClose()} size="md">
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>New activation code</Drawer.Title>
        </Drawer.Header>
        <Drawer.CloseTrigger />
        <Drawer.Body>
          {issued ? (
            <IssuedCode code={issued} />
          ) : (
            <VStack align="start" gap={4} width="full">
              <CustomerFields draft={draft} set={set} />
              <TermsFields draft={draft} set={set} />
              <Checkbox
                checked={draft.reusable}
                onCheckedChange={({ checked }) => set("reusable", checked === true)}
              >
                Reusable, for a customer rolling out several installs
              </Checkbox>
            </VStack>
          )}
        </Drawer.Body>
        <Drawer.Footer borderTopWidth="1px" borderColor="border">
          <HStack gap={3}>
            <Button variant="outline" onClick={onClose}>
              {issued ? "Done" : "Cancel"}
            </Button>
            {issued ? null : (
              <Button
                colorPalette="blue"
                disabled={!namesTheCustomer(draft)}
                loading={commands.issue.isPending}
                onClick={() => {
                  const expiresAt = dateInputToISO(draft.expiresOn);
                  if (!expiresAt) return;
                  commands.issue.mutate(
                    {
                      organizationId: draft.organizationId.trim(),
                      organizationName: draft.organizationName.trim(),
                      email: draft.email.trim(),
                      planType: draft.planType,
                      maxMembers: Number(draft.maxMembers),
                      licenseTermDays: Number(draft.licenseTermDays),
                      services: draft.services,
                      expiresAt,
                      reusable: draft.reusable,
                    },
                    { onSuccess: (result) => setIssued(result.code) },
                  );
                }}
              >
                Issue code
              </Button>
            )}
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}

type SetField = <K extends keyof Draft>(key: K, value: Draft[K]) => void;

function CustomerFields({ draft, set }: { draft: Draft; set: SetField }) {
  return (
    <>
      <Field.Root>
        <Field.Label>Customer organization id</Field.Label>
        <Input
          value={draft.organizationId}
          onChange={(event) => set("organizationId", event.target.value)}
          placeholder="organization_..."
        />
      </Field.Root>
      <Field.Root>
        <Field.Label>Customer name</Field.Label>
        <Input
          value={draft.organizationName}
          onChange={(event) => set("organizationName", event.target.value)}
          placeholder="ACME"
        />
      </Field.Root>
      <Field.Root>
        <Field.Label>Contact email</Field.Label>
        <Input
          value={draft.email}
          onChange={(event) => set("email", event.target.value)}
          placeholder="ops@acme.test"
        />
      </Field.Root>
    </>
  );
}

function TermsFields({ draft, set }: { draft: Draft; set: SetField }) {
  return (
    <>
      <Field.Root>
        <Field.Label>Plan</Field.Label>
        <NativeSelect.Root>
          <NativeSelect.Field
            value={draft.planType}
            onChange={(event) => set("planType", event.target.value as PlanType)}
          >
            {PLANS.map((plan) => (
              <option key={plan} value={plan}>
                {plan}
              </option>
            ))}
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
      </Field.Root>
      <HStack gap={4} width="full" align="start">
        <Field.Root>
          <Field.Label>Seats</Field.Label>
          <Input
            type="number"
            value={draft.maxMembers}
            onChange={(event) => set("maxMembers", event.target.value)}
          />
        </Field.Root>
        <Field.Root>
          <Field.Label>License term, in days</Field.Label>
          <Input
            type="number"
            value={draft.licenseTermDays}
            onChange={(event) => set("licenseTermDays", event.target.value)}
          />
          <Field.HelperText>Counted from the day the code is redeemed.</Field.HelperText>
        </Field.Root>
      </HStack>
      <VStack align="start" gap={2} width="full">
        <Text fontSize="sm" fontWeight="medium">
          Hosted services included
        </Text>
        <HStack gap={4}>
          {SERVICES.map((service) => (
            <Checkbox
              key={service}
              checked={draft.services.includes(service)}
              onCheckedChange={({ checked }) =>
                set(
                  "services",
                  checked === true
                    ? [...draft.services, service]
                    : draft.services.filter((s) => s !== service),
                )
              }
            >
              {SERVICE_LABELS[service]}
            </Checkbox>
          ))}
        </HStack>
        <Text fontSize="xs" color="fg.muted">
          The license the code mints syncs and refreshes on its own only while it names one.
        </Text>
      </VStack>
      <Field.Root>
        <Field.Label>Code expires on</Field.Label>
        <Input
          type="date"
          value={draft.expiresOn}
          onChange={(event) => set("expiresOn", event.target.value)}
        />
      </Field.Root>
    </>
  );
}

function IssuedCode({ code }: { code: string }) {
  return (
    <VStack align="start" gap={3} width="full">
      <Text fontWeight="medium">Activation code</Text>
      <Text fontSize="sm" color="fg.muted">
        Copy it now and send it to the customer. Only a hash of it is stored, so it cannot be shown
        again. If it is lost, issue another and revoke this one.
      </Text>
      <Input
        readOnly
        value={code}
        fontFamily="mono"
        fontSize="lg"
        onFocus={(event) => event.target.select()}
      />
    </VStack>
  );
}
