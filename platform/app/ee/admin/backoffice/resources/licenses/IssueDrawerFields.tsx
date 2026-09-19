import {
  Field,
  HStack,
  Input,
  NativeSelect,
  SimpleGrid,
  Textarea,
} from "@chakra-ui/react";
import type {
  CustomerMode,
  IssueForm,
  IssueMode,
  PlanType,
  SetIssueField,
} from "./issueForm";
import { TermsFields } from "./TermsFields";

const PLANS: PlanType[] = ["ENTERPRISE", "GROWTH", "PRO", "CUSTOM"];

interface FieldsProps {
  form: IssueForm;
  set: SetIssueField;
}

export function IssueModeField({ form, set }: FieldsProps) {
  return (
    <Field.Root>
      <Field.Label>What to do</Field.Label>
      <NativeSelect.Root>
        <NativeSelect.Field
          value={form.mode}
          onChange={(event) => set("mode", event.target.value as IssueMode)}
        >
          <option value="issue">
            Issue a new license, signed with the server key
          </option>
          <option value="register">
            Register a license issued before the registry existed
          </option>
        </NativeSelect.Field>
        <NativeSelect.Indicator />
      </NativeSelect.Root>
    </Field.Root>
  );
}

export function CustomerField({ form, set }: FieldsProps) {
  return (
    <Field.Root>
      <Field.Label>Customer</Field.Label>
      <HStack width="full">
        <NativeSelect.Root width="44">
          <NativeSelect.Field
            value={form.customerMode}
            onChange={(event) =>
              set("customerMode", event.target.value as CustomerMode)
            }
          >
            <option value="existing">Existing organization</option>
            {form.mode === "issue" ? (
              <option value="new">New organization</option>
            ) : null}
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
        {form.customerMode === "existing" ? (
          <Input
            value={form.organizationId}
            onChange={(event) => set("organizationId", event.target.value)}
            placeholder="Organization id on LangWatch Cloud"
          />
        ) : (
          <Input
            value={form.newOrganizationName}
            onChange={(event) => set("newOrganizationName", event.target.value)}
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

export function RegisterLicenseFields({ form, set }: FieldsProps) {
  return (
    <Field.Root required>
      <Field.Label>License</Field.Label>
      <Textarea
        rows={6}
        value={form.licenseKey}
        onChange={(event) => set("licenseKey", event.target.value)}
        fontFamily="mono"
        fontSize="xs"
        placeholder="Paste the license the customer holds. Its signature is verified and only a hash of it is kept."
      />
    </Field.Root>
  );
}

export function IssueLicenseFields({ form, set }: FieldsProps) {
  return (
    <>
      <SimpleGrid columns={2} gap={3} width="full">
        <ContactFields form={form} set={set} />
        <SeatAndTermFields form={form} set={set} />
      </SimpleGrid>
      <TermsFields
        form={form.terms}
        onChange={(terms) => set("terms", terms)}
      />
    </>
  );
}

function ContactFields({ form, set }: FieldsProps) {
  return (
    <>
      <Field.Root required>
        <Field.Label>Contact email</Field.Label>
        <Input
          type="email"
          value={form.email}
          onChange={(event) => set("email", event.target.value)}
        />
      </Field.Root>
      <Field.Root>
        <Field.Label>Plan</Field.Label>
        <NativeSelect.Root>
          <NativeSelect.Field
            value={form.planType}
            onChange={(event) =>
              set("planType", event.target.value as PlanType)
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
    </>
  );
}

function SeatAndTermFields({ form, set }: FieldsProps) {
  return (
    <>
      <Field.Root required>
        <Field.Label>Full member seats</Field.Label>
        <Input
          type="number"
          min={1}
          value={form.maxMembers}
          onChange={(event) => set("maxMembers", event.target.value)}
        />
      </Field.Root>
      <Field.Root>
        <Field.Label>Lite member seats</Field.Label>
        <Input
          type="number"
          min={0}
          value={form.maxMembersLite}
          onChange={(event) => set("maxMembersLite", event.target.value)}
          placeholder="Plan default"
        />
      </Field.Root>
      <Field.Root required>
        <Field.Label>Term ends</Field.Label>
        <Input
          type="date"
          value={form.expiresAt}
          onChange={(event) => set("expiresAt", event.target.value)}
        />
      </Field.Root>
    </>
  );
}
