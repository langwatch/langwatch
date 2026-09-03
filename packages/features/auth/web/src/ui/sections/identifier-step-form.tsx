/// <reference path="../../model/ambient.d.ts" />
import { Button, HStack, Input, VStack } from "@chakra-ui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ReactNode } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import "../elements/auth-front-door.css";
import { SHAPE } from "../../model/front-door-theme";
import { useFocusWhenSettled } from "../../behavior/use-focus-when-settled";
import { FIELD_FOCUS, FIELD_SURFACE, FrontDoorField } from "../elements/front-door-field";
import { MethodDivider } from "../blocks/sign-in-method-picker";

const identifierSchema = z.object({
  email: z
    .string()
    .min(1, { message: "Enter your email address" })
    .email({ message: "That does not look like an email address" }),
});

export type IdentifierStepValues = z.infer<typeof identifierSchema>;

/**
 * The address step: the whole of what the front door asks before it knows
 * anything (ADR-117 §2).
 *
 * It renders the same for every address, and the screen above it asks the same
 * question of the server for every address. Whether an account exists is not
 * knowable from this step, by construction rather than by care.
 *
 * The field is spelled the way a password manager expects to find it —
 * `type="email"`, `name="email"`, `autocomplete="username webauthn"` — so the
 * browser fills it, and so a passkey can be offered against the same field
 * when D07 brings them.
 *
 * A rejection is only ever an answer to something the person wrote. Three
 * rules, in the order they matter:
 *
 *   - An empty field is never an error until they ask to continue. Not on
 *     load, not on blur, not after autofocus lost the caret: empty means
 *     "not started", and "not started" is not wrong.
 *   - What they typed is judged when they leave the field, not while their
 *     hands are still on it. No error appears mid-keystroke.
 *   - A rejection already on screen lifts the moment the address becomes
 *     valid, so fixing it is rewarded live even though breaking it was
 *     never punished live.
 */
export function IdentifierStepForm({
  submitLabel,
  isSubmitting,
  defaultEmail,
  footer,
  alternatives,
  onSubmit,
}: {
  submitLabel: string;
  isSubmitting: boolean;
  defaultEmail?: string;
  footer?: ReactNode;
  /** Methods that can be taken without an address, under a thin "or". */
  alternatives?: ReactNode;
  onSubmit: (values: IdentifierStepValues) => void | Promise<unknown>;
}) {
  const addressField = useFocusWhenSettled();

  const form = useForm<IdentifierStepValues>({
    resolver: zodResolver(identifierSchema),
    // Nothing validates automatically before submit; the handlers below
    // decide when a judgement is welcome.
    mode: "onSubmit",
    reValidateMode: "onSubmit",
    defaultValues: { email: defaultEmail ?? "" },
  });

  const emailRegistration = form.register("email", {
    onBlur: () => {
      const value = form.getValues("email");
      if (value) void form.trigger("email");
      else form.clearErrors("email");
    },
    onChange: () => {
      // Clearing only: typing can lift a rejection, never earn one.
      if (!form.formState.errors.email) return;
      const parsed = identifierSchema.safeParse({
        email: form.getValues("email"),
      });
      if (parsed.success) form.clearErrors("email");
    },
  });

  const showEmailError = form.formState.errors.email;

  return (
    <VStack width="full" align="stretch" gap="14px">
      {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
      <form onSubmit={form.handleSubmit(onSubmit)} style={{ width: "100%" }}>
        <VStack width="full" align="stretch" gap="14px">
          <FrontDoorField label="Email" error={showEmailError}>
            {(id) => (
              <Input
                id={id}
                type="email"
                placeholder="you@company.com"
                // 16px on a phone: anything smaller makes iOS zoom the page in
                // when the field takes focus, and it never zooms back out.
                fontSize={{ base: "16px", md: "14px" }}
                minHeight="44px"
                borderRadius={SHAPE.field}
                autoComplete="username webauthn"
                {...FIELD_SURFACE}
                _focusVisible={FIELD_FOCUS}
                {...emailRegistration}
                // "Required" is answered by coming back to the field, so it
                // clears the moment somebody does — before a keystroke. The
                // rejection said "this is empty"; reaching for it is the whole
                // of the correction, and leaving it red while they type reads
                // as the screen not noticing.
                //
                // Only the empty case. A rejection about the ADDRESS is about
                // what is in the box, and that is still true on focus — it
                // lifts on the keystroke that fixes it (`onChange` above).
                onFocus={() => {
                  if (!form.getValues("email")) form.clearErrors("email");
                }}
                ref={(node) => {
                  emailRegistration.ref(node);
                  addressField.current = node;
                }}
              />
            )}
          </FrontDoorField>
          <VStack width="full" align="stretch" gap="14px" paddingTop="2px">
            <Button
              className="lw-front-door-primary"
              type="submit"
              width="full"
              minHeight="44px"
              fontSize="14px"
              fontWeight={600}
              borderRadius={SHAPE.action}
              backgroundColor={"frontDoor.action"}
              color={"frontDoor.onAction"}
              _hover={{ backgroundColor: "frontDoor.actionHover" }}
              loading={isSubmitting}
            >
              {submitLabel}
            </Button>
            {footer ? <HStack width="full">{footer}</HStack> : null}
          </VStack>
        </VStack>
      </form>
      {alternatives ? (
        <>
          <MethodDivider />
          {alternatives}
        </>
      ) : null}
    </VStack>
  );
}
