import { Alert, Badge, Button, HStack, Text, VStack } from "@chakra-ui/react";
import type { SignInMethod } from "@langwatch/identity";
import type { ReactNode } from "react";
import { signInMethodActionLabel } from "../logic/methodLabels";
import { signInRoutingReasonCopy } from "../logic/routingReasonCopy";
import "../authFrontDoor.css";
import { BRAND, MONO_FONT, SHAPE } from "../logic/brand";
import { METHOD_PREVIEWS_ENABLED, MethodPreviews } from "./MethodPreviews";
import { SignInMethodIcon } from "./SignInMethodIcon";

/**
 * The method picker: exactly the methods the routing decision named, in the
 * order it named them, with the words its reason code is worth (ADR-117 §2,
 * §6).
 *
 * It holds no routing logic and reads nothing about the person. Two visitors
 * whose addresses produce the same decision see the same picker, because the
 * decision is all this component is given — there is nothing else here for
 * them to differ by. The one thing that varies is the "Last used" badge, which
 * is this BROWSER's memory of a method id and knows nothing about accounts.
 *
 * Sign-in and sign-up both render this component. What a LOCAL method means
 * differs between them (a password to type, a password to choose), so each
 * supplies that part; everything else, including which methods exist at all,
 * is the decision's answer rather than the screen's.
 */
export function SignInMethodPicker({
  methodSet,
  reasonCode,
  lastUsedMethodId,
  onFederatedMethodChosen,
  renderLocalMethod,
}: {
  methodSet: readonly SignInMethod[];
  reasonCode: string;
  /** The method this browser last got in with, badged where it appears. */
  lastUsedMethodId?: string | null;
  onFederatedMethodChosen: (method: SignInMethod) => void;
  renderLocalMethod?: (method: SignInMethod) => ReactNode;
}) {
  const guidance = signInRoutingReasonCopy(reasonCode);

  return (
    <VStack width="full" align="stretch" gap={4} data-testid="method-picker">
      {guidance ? (
        <Alert.Root
          status="info"
          borderStartWidth="4px"
          borderStartColor="colorPalette.solid"
        >
          <Alert.Content>
            <Alert.Title>{guidance.title}</Alert.Title>
            <Alert.Description>{guidance.describe}</Alert.Description>
          </Alert.Content>
        </Alert.Root>
      ) : null}

      {methodSet.length === 0 ? (
        <Text>
          There is no way to sign in to this installation yet. Ask whoever runs
          it to set one up.
        </Text>
      ) : null}

      {methodSet.map((method) => (
        <MethodEntry
          key={`${method.kind}:${method.id}:${method.connectionId ?? ""}`}
          method={method}
          isLastUsed={lastUsedMethodId === method.id}
          onFederatedMethodChosen={onFederatedMethodChosen}
          renderLocalMethod={renderLocalMethod}
        />
      ))}
    </VStack>
  );
}

/**
 * Whether the address step has anything to offer under its "or" at all. The
 * divider is the caller's to draw, and a divider over nothing was the old
 * layout's orphan "OR": ask this before passing `alternatives`, and pass
 * nothing when the answer is no.
 */
export function hasAlternativeMethods(
  methodSet: readonly SignInMethod[],
): boolean {
  return (
    METHOD_PREVIEWS_ENABLED ||
    methodSet.some((method) => method.kind === "federated")
  );
}

/**
 * The methods a person can take instead of typing an address: the instance's
 * federated methods, plus the passkey method's reserved place while it is
 * still a preview. Rendered under the address step's divider on both doors,
 * so the two screens offer the same alternatives in the same order.
 */
export function AlternativeMethods({
  methodSet,
  lastUsedMethodId,
  onFederatedMethodChosen,
}: {
  methodSet: readonly SignInMethod[];
  lastUsedMethodId?: string | null;
  onFederatedMethodChosen: (method: SignInMethod) => void;
}) {
  return (
    <VStack
      width="full"
      align="stretch"
      gap={3}
      data-testid="alternative-methods"
    >
      {methodSet
        .filter((method) => method.kind === "federated")
        .map((method) => (
          <FederatedMethodButton
            key={method.id}
            method={method}
            isLastUsed={lastUsedMethodId === method.id}
            onChosen={onFederatedMethodChosen}
          />
        ))}
      <MethodPreviews offered={methodSet} />
    </VStack>
  );
}

/**
 * One full-width button per federated method, marked and named the way the
 * provider is: the mark is what somebody scanning the screen looks for.
 */
export function FederatedMethodButton({
  method,
  isLastUsed,
  onChosen,
}: {
  method: SignInMethod;
  isLastUsed?: boolean;
  onChosen: (method: SignInMethod) => void;
}) {
  return (
    <Button
      variant="outline"
      width="full"
      minHeight="44px"
      position="relative"
      fontWeight={600}
      borderRadius={SHAPE.action}
      justifyContent="center"
      gap="9px"
      overflow="visible"
      _hover={{ backgroundColor: "bg.subtle", borderColor: "fg.subtle" }}
      onClick={() => onChosen(method)}
    >
      <SignInMethodIcon method={method} />
      <Text>{signInMethodActionLabel(method)}</Text>
      {isLastUsed ? (
        <span className="lw-front-door-badge-float">
          <LastUsedBadge />
        </span>
      ) : null}
    </Button>
  );
}

export function LastUsedBadge() {
  return (
    <Badge
      borderRadius="full"
      paddingX="9px"
      fontSize="10px"
      fontWeight={500}
      backgroundColor={BRAND.tint}
      color={BRAND.ink}
      data-testid="last-used-method"
    >
      Last used
    </Badge>
  );
}

/** A thin "or" between the address step and the methods beside it, said the
 *  way the site says its small technical words: mono, spaced, quiet. */
export function MethodDivider() {
  return (
    <HStack width="full" gap="10px" paddingY={1}>
      <Divider />
      <Text
        fontFamily={MONO_FONT}
        fontSize="10px"
        textTransform="uppercase"
        letterSpacing="0.16em"
        color="fg.muted"
      >
        or
      </Text>
      <Divider />
    </HStack>
  );
}

function Divider() {
  return <div className="lw-front-door-hairline" />;
}

function MethodEntry({
  method,
  isLastUsed,
  onFederatedMethodChosen,
  renderLocalMethod,
}: {
  method: SignInMethod;
  isLastUsed: boolean;
  onFederatedMethodChosen: (method: SignInMethod) => void;
  renderLocalMethod?: (method: SignInMethod) => ReactNode;
}) {
  if (method.kind === "federated") {
    return (
      <FederatedMethodButton
        method={method}
        isLastUsed={isLastUsed}
        onChosen={onFederatedMethodChosen}
      />
    );
  }

  const local = renderLocalMethod?.(method);
  if (local) {
    return (
      <VStack width="full" align="stretch" gap={2}>
        {isLastUsed ? (
          <HStack width="full">
            <LastUsedBadge />
          </HStack>
        ) : null}
        {local}
      </VStack>
    );
  }

  // A local method the screen has nothing to render for is still named, so
  // the picker never silently drops a method the decision offered.
  return <Text>{signInMethodActionLabel(method)}</Text>;
}
