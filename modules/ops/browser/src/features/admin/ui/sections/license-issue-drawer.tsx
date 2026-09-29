import {
  Button,
  Field,
  HStack,
  Input,
  NativeSelect,
  SimpleGrid,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { Drawer } from "@langwatch/design-system/drawer";
import { useEffect, useState } from "react";

import { useLicenseCommands } from "../../behavior/use-license-commands.ts";
import { termsFormFrom, termsPayload, type TermsForm } from "../../model/license-terms.ts";
import { LicenseTermsFields } from "../blocks/license-terms-fields.tsx";
import { dateInputToISO } from "../elements/backoffice-cells.tsx";
import { SignedLicenseOnce } from "../elements/signed-license-once.tsx";

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

/** Issue a freshly signed license, or register one issued before the registry existed. */
export function LicenseIssueDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form, setForm] = useState<IssueForm>(emptyIssueForm);
  const [issuedKey, setIssuedKey] = useState<string | null>(null);
  const commands = useLicenseCommands();

  useEffect(() => {
    if (!open) return;
    setForm(emptyIssueForm());
    setIssuedKey(null);
  }, [open]);

  return (
    <Drawer.Root open={open} onOpenChange={({ open: next }) => !next && onClose()} size="lg">
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>New license</Drawer.Title>
        </Drawer.Header>
        <Drawer.CloseTrigger />
        <Drawer.Body>
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
            <CustomerField form={form} setForm={setForm} />
            {form.mode === "register" ? (
              <Field.Root required>
                <Field.Label>License</Field.Label>
                <Textarea
                  rows={6}
                  value={form.licenseKey}
                  onChange={(event) => setForm((c) => ({ ...c, licenseKey: event.target.value }))}
                  fontFamily="mono"
                  fontSize="xs"
                  placeholder="Paste the license the customer holds. Its signature is verified and only a hash of it is kept."
                />
              </Field.Root>
            ) : (
              <>
                <SimpleGrid columns={2} gap={3} width="full">
                  <Field.Root required>
                    <Field.Label>Contact email</Field.Label>
                    <Input
                      type="email"
                      value={form.email}
                      onChange={(event) => setForm((c) => ({ ...c, email: event.target.value }))}
                    />
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
                  <Field.Root required>
                    <Field.Label>Full member seats</Field.Label>
                    <Input
                      type="number"
                      min={1}
                      value={form.maxMembers}
                      onChange={(event) =>
                        setForm((c) => ({ ...c, maxMembers: event.target.value }))
                      }
                    />
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
                  <Field.Root required>
                    <Field.Label>Term ends</Field.Label>
                    <Input
                      type="date"
                      value={form.expiresAt}
                      onChange={(event) =>
                        setForm((c) => ({ ...c, expiresAt: event.target.value }))
                      }
                    />
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
        </Drawer.Body>
        <Drawer.Footer borderTopWidth="1px" borderColor="border">
          <IssueFooter
            form={form}
            issuedKey={issuedKey}
            commands={commands}
            onIssued={setIssuedKey}
            onClose={onClose}
          />
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}

function CustomerField({
  form,
  setForm,
}: {
  form: IssueForm;
  setForm: (updater: (current: IssueForm) => IssueForm) => void;
}) {
  return (
    <Field.Root>
      <Field.Label>Customer</Field.Label>
      <HStack width="full">
        <NativeSelect.Root width="44">
          <NativeSelect.Field
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
            value={form.organizationId}
            onChange={(event) => setForm((c) => ({ ...c, organizationId: event.target.value }))}
            placeholder="Organization id on LangWatch Cloud"
          />
        ) : (
          <Input
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
    </Field.Root>
  );
}

function IssueFooter({
  form,
  issuedKey,
  commands,
  onIssued,
  onClose,
}: {
  form: IssueForm;
  issuedKey: string | null;
  commands: ReturnType<typeof useLicenseCommands>;
  onIssued: (key: string) => void;
  onClose: () => void;
}) {
  return (
    <HStack gap={3}>
      <Button variant="outline" onClick={onClose}>
        {issuedKey ? "Done" : "Cancel"}
      </Button>
      {issuedKey ? null : (
        <SubmitButton form={form} commands={commands} onIssued={onIssued} onRegistered={onClose} />
      )}
    </HStack>
  );
}

function SubmitButton({
  form,
  commands,
  onIssued,
  onRegistered,
}: {
  form: IssueForm;
  commands: ReturnType<typeof useLicenseCommands>;
  onIssued: (key: string) => void;
  onRegistered: () => void;
}) {
  if (form.mode === "register") {
    return (
      <Button
        colorPalette="blue"
        disabled={form.licenseKey.trim() === "" || form.organizationId.trim() === ""}
        loading={commands.registerLegacy.isPending}
        onClick={() =>
          commands.registerLegacy.mutate(
            { licenseKey: form.licenseKey.trim(), organizationId: form.organizationId.trim() },
            { onSuccess: onRegistered },
          )
        }
      >
        Register license
      </Button>
    );
  }

  const customer =
    form.customerMode === "existing"
      ? { organizationId: form.organizationId.trim() }
      : { newOrganizationName: form.newOrganizationName.trim() };
  const customerValid =
    form.customerMode === "existing"
      ? form.organizationId.trim() !== ""
      : form.newOrganizationName.trim() !== "";

  return (
    <Button
      colorPalette="blue"
      disabled={
        !customerValid ||
        form.email.trim() === "" ||
        form.expiresAt === "" ||
        Number(form.maxMembers) < 1
      }
      loading={commands.issue.isPending}
      onClick={() => {
        const iso = dateInputToISO(form.expiresAt);
        if (!iso) return;
        commands.issue.mutate(
          {
            customer,
            email: form.email.trim(),
            planType: form.planType,
            maxMembers: Number(form.maxMembers),
            ...(form.maxMembersLite.trim() === ""
              ? {}
              : { maxMembersLite: Number(form.maxMembersLite) }),
            expiresAt: iso,
            terms: termsPayload(form.terms),
          },
          { onSuccess: (result) => onIssued(result.licenseKey) },
        );
      }}
    >
      Issue license
    </Button>
  );
}
