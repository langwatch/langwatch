import { Field, HStack, Input, NativeSelect, SimpleGrid, VStack } from "@chakra-ui/react";

import {
  SERVICES,
  SERVICE_LABELS,
  withOverageEnabled,
  type TermsForm,
} from "../../model/license-terms.ts";

/** The entitlements and commercial terms, shared by the issue drawer and
 * the terms section. */
export function LicenseTermsFields({
  form,
  onChange,
}: {
  form: TermsForm;
  onChange: (form: TermsForm) => void;
}) {
  const set = <K extends keyof TermsForm>({ key, value }: { key: K; value: TermsForm[K] }) =>
    onChange({ ...form, [key]: value });

  return (
    <VStack align="start" gap={3} width="full">
      <Field.Root>
        <Field.Label>Hosted services included</Field.Label>
        <HStack gap={4}>
          {SERVICES.map((service) => (
            <label key={service} style={{ fontSize: "0.875rem" }}>
              <input
                type="checkbox"
                checked={form.services.includes(service)}
                onChange={(event) =>
                  set({
                    key: "services",
                    value: event.target.checked
                      ? [...form.services, service]
                      : form.services.filter((s) => s !== service),
                  })
                }
              />{" "}
              {SERVICE_LABELS[service]}
            </label>
          ))}
        </HStack>
        <Field.HelperText>Switching a service on does not reissue the license.</Field.HelperText>
      </Field.Root>
      <SimpleGrid columns={2} gap={3} width="full">
        <Field.Root>
          <Field.Label>Seat rate per year</Field.Label>
          <HStack>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={form.seatRate}
              onChange={(event) => set({ key: "seatRate", value: event.target.value })}
            />
            <NativeSelect.Root width="28">
              <NativeSelect.Field
                value={form.seatCurrency}
                onChange={(event) =>
                  set({ key: "seatCurrency", value: event.target.value as "USD" | "EUR" })
                }
              >
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
          </HStack>
        </Field.Root>
        <Field.Root>
          <Field.Label>Prepaid usage commit (USD)</Field.Label>
          <Input
            type="number"
            min={0}
            step="0.01"
            value={form.commit}
            onChange={(event) => set({ key: "commit", value: event.target.value })}
          />
        </Field.Root>
      </SimpleGrid>
      <Field.Root>
        <Field.Label>On-demand overage</Field.Label>
        <HStack>
          <NativeSelect.Root width="28">
            <NativeSelect.Field
              value={form.overageEnabled ? "on" : "off"}
              onChange={(event) => onChange(withOverageEnabled(form, event.target.value === "on"))}
            >
              <option value="off">Off</option>
              <option value="on">On</option>
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
          <Input
            type="number"
            min={0}
            step="0.01"
            disabled={!form.overageEnabled}
            value={form.overageMax}
            onChange={(event) => set({ key: "overageMax", value: event.target.value })}
            placeholder="Maximum (USD)"
          />
        </HStack>
      </Field.Root>
    </VStack>
  );
}
