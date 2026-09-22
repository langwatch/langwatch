import {
  Button,
  Field,
  HStack,
  Input,
  NativeSelect,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useState } from "react";
import { Checkbox } from "~/components/ui/checkbox";
import { Drawer } from "~/components/ui/drawer";
import { HandledErrorAlert } from "~/features/errors";
import { api } from "~/utils/api";
import { dateInputToISO } from "../../BackofficeTable";
import { SERVICE_LABELS, SERVICES, type Service } from "./types";

const PLANS = ["GROWTH", "PRO", "ENTERPRISE", "CUSTOM"] as const;

type Plan = (typeof PLANS)[number];

/** A code is useful for a month; a license it mints runs for a year. */
const DEFAULT_CODE_DAYS = 30;
const DEFAULT_TERM_DAYS = 365;

function isoDaysFromNow(days: number): string {
  const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

interface CodeToIssue {
  organizationId: string;
  organizationName: string;
  email: string;
  planType: Plan;
  maxMembers: number;
  licenseTermDays: number;
  services: Service[];
  expiresAt: Date;
  reusable: boolean;
}

/**
 * Issues an activation code and shows it once.
 *
 * The code is credential material: the registry holds only its hash, so this
 * drawer is the only place it ever appears. Closing it loses it, and the fix
 * for a lost code is to issue another and revoke this one.
 */
export function IssueActivationCodeDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [issued, setIssued] = useState<string | null>(null);

  const issue = api.licenseRegistry.issueActivationCode.useMutation({
    onSuccess: (result) => setIssued(result.code),
  });

  const close = () => {
    setIssued(null);
    issue.reset();
    onClose();
  };

  return (
    <Drawer.Root
      open={open}
      onOpenChange={({ open: isOpen }) => {
        if (!isOpen) close();
      }}
      size="md"
    >
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>New activation code</Drawer.Title>
        </Drawer.Header>
        <Drawer.CloseTrigger />
        <Drawer.Body>
          {issued ? (
            <IssuedCode code={issued} />
          ) : (
            <IssueForm
              error={issue.error}
              pending={issue.isPending}
              onSubmit={(values) => issue.mutate(values)}
            />
          )}
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}

/** What the form holds while it is being filled in, all of it as typed. */
interface Draft {
  organizationId: string;
  organizationName: string;
  email: string;
  planType: Plan;
  maxMembers: string;
  licenseTermDays: string;
  services: Service[];
  expiresOn: string;
  reusable: boolean;
}

// A code is the connected path: the license it mints syncs and refreshes on
// its own only while it names a hosted service, so every one starts included.
const EMPTY_DRAFT: Draft = {
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

type SetField = <K extends keyof Draft>(key: K, value: Draft[K]) => void;

function namesTheCustomer(draft: Draft): boolean {
  return Boolean(
    draft.organizationId.trim() &&
      draft.organizationName.trim() &&
      draft.email.trim(),
  );
}

function issuedFrom(draft: Draft): CodeToIssue | null {
  const expiresAt = dateInputToISO(draft.expiresOn);
  if (!expiresAt) return null;
  return {
    organizationId: draft.organizationId.trim(),
    organizationName: draft.organizationName.trim(),
    email: draft.email.trim(),
    planType: draft.planType,
    maxMembers: Number(draft.maxMembers),
    licenseTermDays: Number(draft.licenseTermDays),
    services: draft.services,
    expiresAt: new Date(expiresAt),
    reusable: draft.reusable,
  };
}

function IssueForm({
  error,
  pending,
  onSubmit,
}: {
  error: unknown;
  pending: boolean;
  onSubmit: (values: CodeToIssue) => void;
}) {
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const set: SetField = (key, value) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const submit = () => {
    const values = issuedFrom(draft);
    if (values) onSubmit(values);
  };

  return (
    <VStack align="start" gap={4} width="full">
      {error ? (
        <HandledErrorAlert
          error={error}
          fallbackTitle="Couldn't issue the activation code"
        />
      ) : null}
      <CustomerFields draft={draft} set={set} />
      <TermsFields draft={draft} set={set} />
      <Checkbox
        checked={draft.reusable}
        onCheckedChange={({ checked }) => set("reusable", checked === true)}
      >
        Reusable, for a customer rolling out several installs
      </Checkbox>
      <Button
        colorPalette="blue"
        onClick={submit}
        loading={pending}
        disabled={!namesTheCustomer(draft)}
      >
        Issue code
      </Button>
    </VStack>
  );
}

function CustomerFields({ draft, set }: { draft: Draft; set: SetField }) {
  return (
    <>
      <Field.Root>
        <Field.Label>Customer organization id</Field.Label>
        <Input
          value={draft.organizationId}
          onChange={(e) => set("organizationId", e.target.value)}
          placeholder="organization_..."
        />
      </Field.Root>
      <Field.Root>
        <Field.Label>Customer name</Field.Label>
        <Input
          value={draft.organizationName}
          onChange={(e) => set("organizationName", e.target.value)}
          placeholder="ACME"
        />
      </Field.Root>
      <Field.Root>
        <Field.Label>Contact email</Field.Label>
        <Input
          value={draft.email}
          onChange={(e) => set("email", e.target.value)}
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
            onChange={(e) => set("planType", e.target.value as Plan)}
          >
            {PLANS.map((plan) => (
              <option key={plan} value={plan}>
                {plan}
              </option>
            ))}
          </NativeSelect.Field>
        </NativeSelect.Root>
      </Field.Root>
      <HStack gap={4} width="full" align="start">
        <Field.Root>
          <Field.Label>Seats</Field.Label>
          <Input
            type="number"
            value={draft.maxMembers}
            onChange={(e) => set("maxMembers", e.target.value)}
          />
        </Field.Root>
        <Field.Root>
          <Field.Label>License term, in days</Field.Label>
          <Input
            type="number"
            value={draft.licenseTermDays}
            onChange={(e) => set("licenseTermDays", e.target.value)}
          />
          <Field.HelperText>
            Counted from the day the code is redeemed.
          </Field.HelperText>
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
          The license the code mints syncs and refreshes on its own only while
          it names one.
        </Text>
      </VStack>
      <Field.Root>
        <Field.Label>Code expires on</Field.Label>
        <Input
          type="date"
          value={draft.expiresOn}
          onChange={(e) => set("expiresOn", e.target.value)}
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
        Copy it now and send it to the customer. Only a hash of it is stored, so
        it cannot be shown again. If it is lost, issue another and revoke this
        one.
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
