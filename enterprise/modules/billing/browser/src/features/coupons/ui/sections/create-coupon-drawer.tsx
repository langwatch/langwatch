// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { applyHandledErrorToForm, showErrorToast } from "@langwatch/browser-host/errors";
import { Checkbox } from "@langwatch/design-system/checkbox";
import { Drawer } from "@langwatch/design-system/drawer";
import {
  Field,
  HStack,
  Input,
  NativeSelect,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import type { CouponDuration } from "@langwatch/enterprise-billing-contract";
import { nowInstant } from "@langwatch/time";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { useCouponCommands } from "../../behavior/use-coupon-commands.ts";
import {
  type CouponDraft,
  type CouponField,
  type CouponProblems,
  couponProblemsOf,
  couponRequestFrom,
  emptyCouponDraft,
} from "../../model/coupon-form.ts";

/** The controls a failed submit can land on; wrappers that carry the state are skipped. */
const INVALID_CONTROL = 'input[aria-invalid="true"], select[aria-invalid="true"]';

const DURATIONS: { value: CouponDuration; label: string }[] = [
  { value: "repeating", label: "For a number of months" },
  { value: "once", label: "First invoice only" },
  { value: "forever", label: "Forever" },
];

const COUPON_FIELDS: readonly CouponField[] = [
  "percentOff",
  "durationInMonths",
  "code",
  "maxRedemptions",
  "expiresAt",
];
const isCouponField = (name: string): name is CouponField =>
  (COUPON_FIELDS as readonly string[]).includes(name);

/**
 * Creates a percentage coupon on Growth Seats with one promotion code: the only kind the
 * prorated Growth checkout accepts, so a fixed amount or a first-time-only code is not offered.
 */
export function CreateCouponDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [draft, setDraft] = useState<CouponDraft>(emptyCouponDraft);
  const [attempts, setAttempts] = useState(0);
  const [serverProblems, setServerProblems] = useState<CouponProblems>({});
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const commands = useCouponCommands();

  useEffect(() => {
    if (!open) return;
    setDraft(emptyCouponDraft());
    setAttempts(0);
    setServerProblems({});
  }, [open]);

  useEffect(() => {
    if (attempts === 0) return;
    formRef.current?.querySelector<HTMLElement>(INVALID_CONTROL)?.focus();
  }, [attempts]);

  const problems: CouponProblems = {
    ...serverProblems,
    ...(attempts > 0 ? couponProblemsOf({ draft, now: nowInstant() }) : {}),
  };

  const set = <K extends keyof CouponDraft>(key: K, value: CouponDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setServerProblems({});
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (commands.create.isPending) return;
    const problems = couponProblemsOf({ draft, now: nowInstant() });
    if (Object.keys(problems).length > 0) {
      setAttempts((count) => count + 1);
      return;
    }
    commands.create.mutate(couponRequestFrom(draft), {
      onSuccess: onClose,
      onError: (error: unknown) => {
        const placed: CouponProblems = {};
        const onForm = applyHandledErrorToForm({
          error,
          form: {
            setError: (name, { message }) => {
              if (isCouponField(name)) placed[name] = message;
            },
          },
        });
        if (onForm && Object.keys(placed).length > 0) {
          setServerProblems(placed);
          setAttempts((count) => count + 1);
          return;
        }
        showErrorToast({ error, fallbackTitle: "The coupon was not created" });
      },
    });
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="New coupon"
      size="md"
      footer={{
        cancel: { onClick: onClose },
        primaryAction: {
          label: "Create coupon",
          type: "submit",
          form: formId,
          loading: commands.create.isPending,
        },
      }}
    >
      <form id={formId} ref={formRef} noValidate onSubmit={submit}>
        <VStack align="start" gap={4} width="full">
          <Text fontSize="sm" color="fg.muted">
            A percentage off Growth Seats. The Growth checkout refuses fixed-amount coupons, so this
            page only makes percentage ones.
          </Text>
          <DiscountFields draft={draft} set={set} problems={problems} />
          <CodeFields draft={draft} set={set} problems={problems} />
          <Checkbox
            checked={draft.includeEvents}
            onCheckedChange={({ checked }) => set("includeEvents", checked === true)}
          >
            Also discount event usage
          </Checkbox>
        </VStack>
      </form>
    </Drawer>
  );
}

type SetField = <K extends keyof CouponDraft>(key: K, value: CouponDraft[K]) => void;

function DiscountFields({
  draft,
  set,
  problems,
}: {
  draft: CouponDraft;
  set: SetField;
  problems: CouponProblems;
}) {
  return (
    <>
      <Field.Root invalid={problems.percentOff !== undefined}>
        <Field.Label>Percent off</Field.Label>
        <Input
          type="number"
          inputMode="decimal"
          min={1}
          max={100}
          aria-invalid={problems.percentOff !== undefined || undefined}
          value={draft.percentOff}
          onChange={(event) => set("percentOff", event.target.value)}
          placeholder="50"
        />
        <Field.ErrorText>{problems.percentOff}</Field.ErrorText>
      </Field.Root>
      <HStack align="start" gap={3} width="full">
        <Field.Root>
          <Field.Label>Lasts</Field.Label>
          <NativeSelect.Root>
            <NativeSelect.Field
              value={draft.duration}
              onChange={(event) => {
                const picked = DURATIONS.find((option) => option.value === event.target.value);
                if (picked) set("duration", picked.value);
              }}
            >
              {DURATIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        </Field.Root>
        {draft.duration === "repeating" ? (
          <Field.Root invalid={problems.durationInMonths !== undefined}>
            <Field.Label>Months</Field.Label>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              aria-invalid={problems.durationInMonths !== undefined || undefined}
              value={draft.durationInMonths}
              onChange={(event) => set("durationInMonths", event.target.value)}
            />
            <Field.ErrorText>{problems.durationInMonths}</Field.ErrorText>
          </Field.Root>
        ) : null}
      </HStack>
      <Field.Root>
        <Field.Label>Name</Field.Label>
        <Input
          maxLength={40}
          value={draft.name}
          onChange={(event) => set("name", event.target.value)}
          placeholder="Shown to the customer at checkout"
        />
      </Field.Root>
    </>
  );
}

function CodeFields({
  draft,
  set,
  problems,
}: {
  draft: CouponDraft;
  set: SetField;
  problems: CouponProblems;
}) {
  return (
    <>
      <Field.Root invalid={problems.code !== undefined}>
        <Field.Label>Code</Field.Label>
        <Input
          aria-invalid={problems.code !== undefined || undefined}
          value={draft.code}
          onChange={(event) => set("code", event.target.value.toUpperCase())}
          placeholder="WELCOME50"
          fontFamily="mono"
        />
        <Field.HelperText>What the customer types at checkout.</Field.HelperText>
        <Field.ErrorText>{problems.code}</Field.ErrorText>
      </Field.Root>
      <HStack align="start" gap={3} width="full">
        <Field.Root invalid={problems.maxRedemptions !== undefined}>
          <Field.Label>Redemption limit</Field.Label>
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            aria-invalid={problems.maxRedemptions !== undefined || undefined}
            value={draft.maxRedemptions}
            onChange={(event) => set("maxRedemptions", event.target.value)}
            placeholder="No limit"
          />
          <Field.ErrorText>{problems.maxRedemptions}</Field.ErrorText>
        </Field.Root>
        <Field.Root invalid={problems.expiresAt !== undefined}>
          <Field.Label>Code expires on</Field.Label>
          <Input
            type="date"
            aria-invalid={problems.expiresAt !== undefined || undefined}
            value={draft.expiresOn}
            onChange={(event) => set("expiresOn", event.target.value)}
          />
          <Field.ErrorText>{problems.expiresAt}</Field.ErrorText>
        </Field.Root>
      </HStack>
    </>
  );
}
