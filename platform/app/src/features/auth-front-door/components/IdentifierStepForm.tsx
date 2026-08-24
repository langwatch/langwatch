import { Button, HStack, Input, Text, VStack } from "@chakra-ui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { type ReactNode, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import "../authFrontDoor.css";
import { useFocusWhenSettled } from "../hooks/useFocusWhenSettled";
import { BRAND, SHAPE } from "../logic/brand";
import { FIELD_FOCUS, FIELD_SURFACE, FrontDoorField } from "./FrontDoorField";
import { MethodDivider } from "./SignInMethodPicker";

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
 * A rejection is only ever an answer to something the person did. The empty
 * field never complains on arrival: "Enter your email address" appears after
 * they have left the field empty having actually been in it, after they have
 * typed something and deleted it, or on submit — never because the page
 * loaded, and never because autofocus put the caret there and something else
 * took it away.
 */
export function IdentifierStepForm({
  intro,
  submitLabel,
  isSubmitting,
  defaultEmail,
  footer,
  alternatives,
  onSubmit,
}: {
  intro?: ReactNode;
  submitLabel: string;
  isSubmitting: boolean;
  defaultEmail?: string;
  footer?: ReactNode;
  /** Methods that can be taken without an address, under a thin "or". */
  alternatives?: ReactNode;
  onSubmit: (values: IdentifierStepValues) => void | Promise<unknown>;
}) {
  const addressField = useFocusWhenSettled();

  // What the person has actually done, as opposed to what the browser did to
  // the field. Autofocus focuses it and a stray click blurs it, and neither
  // is the person leaving the field: only a pointer or a key inside the field
  // counts as having been in it. State rather than a ref, because a rejection
  // the resolver has already recorded becomes visible the moment this flips,
  // and a ref flipping repaints nothing.
  const [wasInField, setWasInField] = useState(false);
  // Once there has been content, an empty field is a deletion, and the
  // rejection may say so immediately rather than waiting for a blur.
  const hadContent = useRef(false);

  const form = useForm<IdentifierStepValues>({
    resolver: zodResolver(identifierSchema),
    mode: "onTouched",
    defaultValues: { email: defaultEmail ?? "" },
  });

  const emailRegistration = form.register("email", {
    onChange: (event: { target: { value: string } }) => {
      if (event.target.value) {
        hadContent.current = true;
      } else if (hadContent.current) {
        void form.trigger("email");
      }
    },
  });

  const emailError = form.formState.errors.email;
  const showEmailError =
    emailError && (form.formState.isSubmitted || wasInField)
      ? emailError
      : undefined;

  return (
    <VStack width="full" align="stretch" gap="14px">
      {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
      <form onSubmit={form.handleSubmit(onSubmit)} style={{ width: "100%" }}>
        <VStack width="full" align="stretch" gap="14px">
          {intro ? (
            <Text
              width="full"
              fontSize="13.5px"
              lineHeight="1.55"
              color="fg.muted"
            >
              {intro}
            </Text>
          ) : null}
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
                onPointerDown={() => setWasInField(true)}
                onKeyDown={() => setWasInField(true)}
                {...emailRegistration}
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
              backgroundColor={BRAND.action}
              color={BRAND.onAction}
              _hover={{ backgroundColor: BRAND.actionHover }}
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
