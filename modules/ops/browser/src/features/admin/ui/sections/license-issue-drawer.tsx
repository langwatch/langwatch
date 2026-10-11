import { Drawer } from "@langwatch/design-system/drawer";
import {
  Field,
  HStack,
  Input,
  NativeSelect,
  SimpleGrid,
  Textarea,
  VStack,
} from "@langwatch/design-system/primitives";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { useLicenseCommands } from "../../behavior/use-license-commands.ts";
import { termsFormFrom, termsPayload, type TermsForm } from "../../model/license-terms.ts";
import { LicenseTermsFields } from "../blocks/license-terms-fields.tsx";
import { dateInputToISO } from "../elements/admin-cells.tsx";
import { SignedLicenseOnce } from "../elements/signed-license-once.tsx";

/** The controls a failed submit can land on; wrappers that carry the state are skipped. */
const INVALID_CONTROL =
  'input[aria-invalid="true"], textarea[aria-invalid="true"], select[aria-invalid="true"]';

type IssueMode = "issue" | "register";
type CustomerMode = "existing" | "new";
type PlanType = "GROWTH" | "PRO" | "ENTERPRISE" | "CUSTOM";
const PLANS: PlanType[] = ["ENTERPRISE", "GROWTH", "PRO", "CUSTOM"];

interface IssueForm {
  mode: IssueMode;
  customerMode: CustomerMode;
  organizationId: string;
  newOrganizationName: string;
  email: string;
  planType: PlanType;
  maxMembers: string;
  maxMembersLite: string;
  expiresAt: string;
  terms: TermsForm;
  licenseKey: string;
}

function emptyIssueForm(): IssueForm {
  return {
    mode: "issue",
    customerMode: "existing",
    organizationId: "",
    newOrganizationName: "",
    email: "",
    planType: "ENTERPRISE",
    maxMembers: "10",
    maxMembersLite: "",
    expiresAt: "",
    terms: termsFormFrom(null),
    licenseKey: "",
  };
}

type Problems = Partial<
  Record<
    "organizationId" | "newOrganizationName" | "licenseKey" | "email" | "maxMembers" | "expiresAt",
    string
  >
>;

function problemsOf(form: IssueForm): Problems {
  const problems: Problems = {};
  if (form.customerMode === "existing" && form.organizationId.trim() === "") {
    problems.organizationId = "Enter the organization id.";
  }
  if (form.customerMode === "new" && form.newOrganizationName.trim() === "") {
    problems.newOrganizationName = "Enter the customer name.";
  }
  if (form.mode === "register") {
    if (form.licenseKey.trim() === "")
      problems.licenseKey = "Paste the license the customer holds.";
    return problems;
  }
  if (form.email.trim() === "") problems.email = "Enter a contact email.";
  if (!(Number(form.maxMembers) >= 1)) problems.maxMembers = "Enter at least 1 full member seat.";
  if (form.expiresAt === "" || !dateInputToISO(form.expiresAt)) {
    problems.expiresAt = "Choose when the term ends.";
  }
  return problems;
}

function sendForm({
  form,
  commands,
  onRegistered,
  onIssued,
}: {
  form: IssueForm;
  commands: ReturnType<typeof useLicenseCommands>;
  onRegistered: () => void;
  onIssued: (key: string) => void;
}) {
  if (form.mode === "register") {
    commands.registerLegacy.mutate(
      { licenseKey: form.licenseKey.trim(), organizationId: form.organizationId.trim() },
      { onSuccess: onRegistered },
    );
    return;
  }
  const iso = dateInputToISO(form.expiresAt);
  if (!iso) return;
  commands.issue.mutate(
    {
      customer:
        form.customerMode === "existing"
          ? { organizationId: form.organizationId.trim() }
          : { newOrganizationName: form.newOrganizationName.trim() },
      email: form.email.trim(),
      planType: form.planType,
      maxMembers: Number(form.maxMembers),
      ...(form.maxMembersLite.trim() === "" ? {} : { maxMembersLite: Number(form.maxMembersLite) }),
      expiresAt: iso,
      terms: termsPayload(form.terms),
    },
    { onSuccess: (result) => onIssued(result.licenseKey) },
  );
}

/** Issue a freshly signed license, or register one issued before the registry existed. */
export function LicenseIssueDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form, setForm] = useState<IssueForm>(emptyIssueForm);
  const [issuedKey, setIssuedKey] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const commands = useLicenseCommands();

  useEffect(() => {
    if (!open) return;
    setForm(emptyIssueForm());
    setIssuedKey(null);
    setAttempts(0);
  }, [open]);

  useEffect(() => {
    if (attempts === 0) return;
    formRef.current?.querySelector<HTMLElement>(INVALID_CONTROL)?.focus();
  }, [attempts]);

  const problems = attempts > 0 ? problemsOf(form) : {};
  const pending = commands.issue.isPending || commands.registerLegacy.isPending;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    if (Object.keys(problemsOf(form)).length > 0) {
      setAttempts((count) => count + 1);
      return;
    }
    sendForm({ form, commands, onRegistered: onClose, onIssued: setIssuedKey });
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="New license"
      size="lg"
      footer={
        issuedKey
          ? { cancel: { label: "Done", onClick: onClose } }
          : {
              cancel: { onClick: onClose },
              primaryAction: {
                label: form.mode === "register" ? "Register license" : "Issue license",
                type: "submit",
                form: formId,
                loading: pending,
              },
            }
      }
    >
      <form id={formId} ref={formRef} noValidate onSubmit={submit}>
        <VStack align="start" gap={4} width="full">
          <Field.Root>
            <Field.Label>What to do</Field.Label>
            <NativeSelect.Root>
              <NativeSelect.Field
                value={form.mode}
                onChange={(event) => {
                  const mode = event.target.value as IssueMode;
                  setForm((current) => ({
                    ...current,
                    mode,
                    customerMode: mode === "register" ? "existing" : current.customerMode,
                  }));
                }}
              >
                <option value="issue">Issue a new license, signed with the server key</option>
                <option value="register">
                  Register a license issued before the registry existed
                </option>
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
          </Field.Root>
          <CustomerField form={form} setForm={setForm} problems={problems} />
          {form.mode === "register" ? (
            <Field.Root required invalid={problems.licenseKey !== undefined}>
              <Field.Label>License</Field.Label>
              <Textarea
                rows={6}
                aria-invalid={problems.licenseKey !== undefined || undefined}
                value={form.licenseKey}
                onChange={(event) => setForm((c) => ({ ...c, licenseKey: event.target.value }))}
                fontFamily="mono"
                fontSize="xs"
                placeholder="Paste the license the customer holds. Its signature is verified and only a hash of it is kept."
              />
              <Field.ErrorText>{problems.licenseKey}</Field.ErrorText>
            </Field.Root>
          ) : (
            <>
              <SimpleGrid columns={2} gap={3} width="full">
                <Field.Root required invalid={problems.email !== undefined}>
                  <Field.Label>Contact email</Field.Label>
                  <Input
                    type="email"
                    aria-invalid={problems.email !== undefined || undefined}
                    value={form.email}
                    onChange={(event) => setForm((c) => ({ ...c, email: event.target.value }))}
                  />
                  <Field.ErrorText>{problems.email}</Field.ErrorText>
                </Field.Root>
                <Field.Root>
                  <Field.Label>Plan</Field.Label>
                  <NativeSelect.Root>
                    <NativeSelect.Field
                      value={form.planType}
                      onChange={(event) =>
                        setForm((c) => ({ ...c, planType: event.target.value as PlanType }))
                      }
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
                <Field.Root required invalid={problems.maxMembers !== undefined}>
                  <Field.Label>Full member seats</Field.Label>
                  <Input
                    type="number"
                    min={1}
                    aria-invalid={problems.maxMembers !== undefined || undefined}
                    value={form.maxMembers}
                    onChange={(event) => setForm((c) => ({ ...c, maxMembers: event.target.value }))}
                  />
                  <Field.ErrorText>{problems.maxMembers}</Field.ErrorText>
                </Field.Root>
                <Field.Root>
                  <Field.Label>Lite member seats</Field.Label>
                  <Input
                    type="number"
                    min={0}
                    value={form.maxMembersLite}
                    onChange={(event) =>
                      setForm((c) => ({ ...c, maxMembersLite: event.target.value }))
                    }
                    placeholder="Plan default"
                  />
                </Field.Root>
                <Field.Root required invalid={problems.expiresAt !== undefined}>
                  <Field.Label>Term ends</Field.Label>
                  <Input
                    type="date"
                    aria-invalid={problems.expiresAt !== undefined || undefined}
                    value={form.expiresAt}
                    onChange={(event) => setForm((c) => ({ ...c, expiresAt: event.target.value }))}
                  />
                  <Field.ErrorText>{problems.expiresAt}</Field.ErrorText>
                </Field.Root>
              </SimpleGrid>
              <LicenseTermsFields
                form={form.terms}
                onChange={(terms) => setForm((c) => ({ ...c, terms }))}
              />
            </>
          )}
          {issuedKey ? <SignedLicenseOnce licenseKey={issuedKey} /> : null}
        </VStack>
      </form>
    </Drawer>
  );
}

function CustomerField({
  form,
  setForm,
  problems,
}: {
  form: IssueForm;
  problems: Problems;
  setForm: (updater: (current: IssueForm) => IssueForm) => void;
}) {
  const problem =
    form.customerMode === "existing" ? problems.organizationId : problems.newOrganizationName;
  return (
    <Field.Root invalid={problem !== undefined}>
      <Field.Label>Customer</Field.Label>
      <HStack width="full">
        <NativeSelect.Root width="44">
          <NativeSelect.Field
            aria-invalid={false}
            value={form.customerMode}
            onChange={(event) =>
              setForm((c) => ({ ...c, customerMode: event.target.value as CustomerMode }))
            }
          >
            <option value="existing">Existing organization</option>
            {form.mode === "issue" ? <option value="new">New organization</option> : null}
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
        {form.customerMode === "existing" ? (
          <Input
            aria-invalid={problem !== undefined || undefined}
            value={form.organizationId}
            onChange={(event) => setForm((c) => ({ ...c, organizationId: event.target.value }))}
            placeholder="Organization id on LangWatch Cloud"
          />
        ) : (
          <Input
            aria-invalid={problem !== undefined || undefined}
            value={form.newOrganizationName}
            onChange={(event) =>
              setForm((c) => ({ ...c, newOrganizationName: event.target.value }))
            }
            placeholder="Customer name, for example ACME"
          />
        )}
      </HStack>
      <Field.HelperText>
        The organization hosted usage, budgets and invoices attach to.
      </Field.HelperText>
      <Field.ErrorText>{problem}</Field.ErrorText>
    </Field.Root>
  );
}
