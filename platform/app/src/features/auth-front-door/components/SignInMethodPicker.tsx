import { Alert, Badge, Button, HStack, Text, VStack } from "@chakra-ui/react";
import type { SignInMethod } from "@langwatch/identity";
import type { ReactNode } from "react";
import { signInMethodActionLabel } from "../logic/methodLabels";
import { signInRoutingReasonCopy } from "../logic/routingReasonCopy";
import "../authFrontDoor.css";
import { BRAND, SHAPE } from "../logic/brand";
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
      className="lw-front-door-primary"
      variant="outline"
      width="full"
      minHeight="44px"
      borderRadius={SHAPE.action}
      justifyContent="flex-start"
      gap={3}
      onClick={() => onChosen(method)}
    >
      <SignInMethodIcon method={method} />
      <Text>{signInMethodActionLabel(method)}</Text>
      {isLastUsed ? <LastUsedBadge /> : null}
    </Button>
  );
}

export function LastUsedBadge() {
  return (
    <Badge
      marginStart="auto"
      borderRadius="full"
      paddingX={2}
      backgroundColor={BRAND.tint}
      color={BRAND.ink}
      data-testid="last-used-method"
    >
      Last used
    </Badge>
  );
}

/** A thin "or" between the address step and the methods beside it. */
export function MethodDivider() {
  return (
    <HStack width="full" gap={3} paddingY={1}>
      <Divider />
      <Text fontSize="13px" color="gray.500">
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
