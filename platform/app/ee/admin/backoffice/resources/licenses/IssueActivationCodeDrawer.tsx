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

function IssueForm({
  error,
  pending,
  onSubmit,
}: {
  error: unknown;
  pending: boolean;
  onSubmit: (values: CodeToIssue) => void;
}) {
  const [organizationId, setOrganizationId] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [email, setEmail] = useState("");
  const [planType, setPlanType] = useState<Plan>("ENTERPRISE");
  const [maxMembers, setMaxMembers] = useState("25");
  const [licenseTermDays, setLicenseTermDays] = useState(
    String(DEFAULT_TERM_DAYS),
  );
  const [expiresOn, setExpiresOn] = useState(isoDaysFromNow(DEFAULT_CODE_DAYS));
  const [reusable, setReusable] = useState(false);

  const submit = () => {
    const expiresAt = dateInputToISO(expiresOn);
    if (!expiresAt) return;
    onSubmit({
      organizationId: organizationId.trim(),
      organizationName: organizationName.trim(),
      email: email.trim(),
      planType,
      maxMembers: Number(maxMembers),
      licenseTermDays: Number(licenseTermDays),
      expiresAt: new Date(expiresAt),
      reusable,
    });
  };

  return (
    <VStack align="start" gap={4} width="full">
      {error ? (
        <HandledErrorAlert
          error={error}
          fallbackTitle="Couldn't issue the activation code"
        />
      ) : null}
      <Field.Root>
        <Field.Label>Customer organization id</Field.Label>
        <Input
          value={organizationId}
          onChange={(e) => setOrganizationId(e.target.value)}
          placeholder="organization_..."
        />
      </Field.Root>
      <Field.Root>
        <Field.Label>Customer name</Field.Label>
        <Input
          value={organizationName}
          onChange={(e) => setOrganizationName(e.target.value)}
          placeholder="ACME"
        />
      </Field.Root>
      <Field.Root>
        <Field.Label>Contact email</Field.Label>
        <Input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="ops@acme.test"
        />
      </Field.Root>
      <Field.Root>
        <Field.Label>Plan</Field.Label>
        <NativeSelect.Root>
          <NativeSelect.Field
            value={planType}
            onChange={(e) => setPlanType(e.target.value as Plan)}
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
            value={maxMembers}
            onChange={(e) => setMaxMembers(e.target.value)}
          />
        </Field.Root>
        <Field.Root>
          <Field.Label>License term, in days</Field.Label>
          <Input
            type="number"
            value={licenseTermDays}
            onChange={(e) => setLicenseTermDays(e.target.value)}
          />
          <Field.HelperText>
            Counted from the day the code is redeemed.
          </Field.HelperText>
        </Field.Root>
      </HStack>
      <Field.Root>
        <Field.Label>Code expires on</Field.Label>
        <Input
          type="date"
          value={expiresOn}
          onChange={(e) => setExpiresOn(e.target.value)}
        />
      </Field.Root>
      <Checkbox
        checked={reusable}
        onCheckedChange={({ checked }) => setReusable(checked === true)}
      >
        Reusable, for a customer rolling out several installs
      </Checkbox>
      <Button
        colorPalette="blue"
        onClick={submit}
        loading={pending}
        disabled={
          !organizationId.trim() || !organizationName.trim() || !email.trim()
        }
      >
        Issue code
      </Button>
    </VStack>
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
