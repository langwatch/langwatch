import { Button, HStack, Input, Text, VStack } from "@chakra-ui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ReactNode } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { HorizontalFormControl } from "~/components/HorizontalFormControl";
import "../authFrontDoor.css";
import { BRAND, SHAPE } from "../logic/brand";
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
 * when D07 brings them. Validation runs on blur, in the same words the server
 * would answer with, so the round trip is usually not needed at all.
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
  const form = useForm<IdentifierStepValues>({
    resolver: zodResolver(identifierSchema),
    mode: "onBlur",
    defaultValues: { email: defaultEmail ?? "" },
  });

  return (
    <VStack width="full" align="stretch" gap={4}>
      {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
      <form onSubmit={form.handleSubmit(onSubmit)} style={{ width: "100%" }}>
        <VStack width="full" align="stretch" gap={4}>
          {intro ? <Text width="full">{intro}</Text> : null}
          <HorizontalFormControl
            direction="vertical"
            size="sm"
            label="Email"
            helper="Enter your email"
            invalid={form.formState.errors.email?.message !== undefined}
            error={form.formState.errors.email}
          >
            <Input
              type="email"
              // 16px on a phone: anything smaller makes iOS zoom the page in
              // when the field takes focus, and it never zooms back out.
              fontSize={{ base: "16px", md: "sm" }}
              minHeight="44px"
              borderRadius={SHAPE.field}
              autoComplete="username webauthn"
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              {...form.register("email")}
            />
          </HorizontalFormControl>
          <VStack width="full" align="stretch" gap={3} paddingTop={2}>
            <Button
              className="lw-front-door-primary"
              type="submit"
              width="full"
              minHeight="44px"
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
