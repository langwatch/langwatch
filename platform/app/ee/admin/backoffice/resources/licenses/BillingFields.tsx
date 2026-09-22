import {
  Field,
  HStack,
  Input,
  NativeSelect,
  SimpleGrid,
  VStack,
} from "@chakra-ui/react";
import type { BankTransferChoice, BillingForm } from "./billingForm";

type SetField = <K extends keyof BillingForm>(change: {
  key: K;
  value: BillingForm[K];
}) => void;

/** The contract an operator onboards or renews on. */
export function BillingFields({
  form,
  onChange,
  showPaymentFields,
}: {
  form: BillingForm;
  onChange: (form: BillingForm) => void;
  showPaymentFields: boolean;
}) {
  const set: SetField = ({ key, value }) => onChange({ ...form, [key]: value });
  return (
    <VStack align="start" gap={3} width="full">
      <SimpleGrid columns={2} gap={3} width="full">
        <Field.Root>
          <Field.Label>Term starts</Field.Label>
          <Input
            type="date"
            value={form.termStartsAt}
            onChange={(event) =>
              set({ key: "termStartsAt", value: event.target.value })
            }
          />
        </Field.Root>
        <Field.Root>
          <Field.Label>Term ends</Field.Label>
          <Input
            type="date"
            value={form.termEndsAt}
            onChange={(event) =>
              set({ key: "termEndsAt", value: event.target.value })
            }
          />
        </Field.Root>
        <Field.Root>
          <Field.Label>Seats</Field.Label>
          <Input
            type="number"
            min={1}
            value={form.seats}
            onChange={(event) =>
              set({ key: "seats", value: event.target.value })
            }
          />
        </Field.Root>
        <Field.Root>
          <Field.Label>Seat rate per year</Field.Label>
          <HStack>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={form.seatRate}
              onChange={(event) =>
                set({ key: "seatRate", value: event.target.value })
              }
            />
            <NativeSelect.Root width="28">
              <NativeSelect.Field
                value={form.seatCurrency}
                onChange={(event) =>
                  set({
                    key: "seatCurrency",
                    value: event.target.value as "USD" | "EUR",
                  })
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
            onChange={(event) =>
              set({ key: "commit", value: event.target.value })
            }
          />
          <Field.HelperText>
            Must match the commit agreed on the license.
          </Field.HelperText>
        </Field.Root>
      </SimpleGrid>
      {showPaymentFields ? <PaymentFields form={form} set={set} /> : null}
    </VStack>
  );
}

function PaymentFields({ form, set }: { form: BillingForm; set: SetField }) {
  return (
    <SimpleGrid columns={2} gap={3} width="full">
      <Field.Root>
        <Field.Label>Billing email</Field.Label>
        <Input
          type="email"
          value={form.billingEmail}
          onChange={(event) =>
            set({ key: "billingEmail", value: event.target.value })
          }
        />
      </Field.Root>
      <Field.Root>
        <Field.Label>Bank transfer</Field.Label>
        <HStack>
          <NativeSelect.Root>
            <NativeSelect.Field
              value={form.bankTransferType}
              onChange={(event) =>
                set({
                  key: "bankTransferType",
                  value: event.target.value as BankTransferChoice,
                })
              }
            >
              <option value="">
                Wire to LangWatch, marked paid by finance
              </option>
              <option value="us_bank_transfer">
                United States, in dollars
              </option>
              <option value="eu_bank_transfer">Europe, in euros</option>
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
          <Input
            width="24"
            maxLength={2}
            placeholder="NL"
            disabled={form.bankTransferType !== "eu_bank_transfer"}
            value={form.bankTransferCountry}
            onChange={(event) =>
              set({ key: "bankTransferCountry", value: event.target.value })
            }
          />
        </HStack>
      </Field.Root>
    </SimpleGrid>
  );
}
