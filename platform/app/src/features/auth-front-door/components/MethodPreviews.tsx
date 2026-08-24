import { Badge, Button, Text } from "@chakra-ui/react";
import type { SignInMethod } from "@langwatch/identity";
import "../authFrontDoor.css";
import { BRAND, SHAPE } from "../logic/brand";
import { signInMethodActionLabel } from "../logic/methodLabels";
import { SignInMethodIcon } from "./SignInMethodIcon";

/**
 * Development-only stand-ins for the methods the picker will hold once they
 * are real: the cloud's social set (whose credentials are not mounted on a
 * local stack) and the passkey method (which D07 has not built yet).
 *
 * They exist so the finished picker's shape is visible during design review
 * on a stack that cannot offer the real buttons, and only there: outside dev
 * the previews render nothing, and the picker holds exactly what the routing
 * decision named.
 */
export const METHOD_PREVIEWS_ENABLED = import.meta.env.DEV;

/** The cloud's social set, as the decision will name it once the credentials
 *  are mounted. Shape only: ids match the real provider ids so the marks and
 *  labels are the real ones. */
const SOCIAL_PREVIEW_METHODS: readonly SignInMethod[] = [
  { id: "google", kind: "federated", connectionId: null },
  { id: "github", kind: "federated", connectionId: null },
  { id: "azure-ad", kind: "federated", connectionId: null },
];

const PASSKEY_PREVIEW_METHOD: SignInMethod = {
  id: "passkey",
  kind: "passkey",
  connectionId: null,
};

/**
 * Every preview method's place in the picker, minus the ones the deployment
 * already offers for real. Renders nothing outside dev.
 */
export function MethodPreviews({
  offered,
}: {
  /** The methods the routing decision actually named, so a preview never
   *  doubles a real button. */
  offered: readonly SignInMethod[];
}) {
  if (!METHOD_PREVIEWS_ENABLED) return null;

  const offeredIds = new Set(offered.map((method) => method.id));
  const previews = SOCIAL_PREVIEW_METHODS.filter(
    (method) => !offeredIds.has(method.id),
  );

  return (
    <>
      {previews.map((method) => (
        <PreviewMethodButton
          key={method.id}
          method={method}
          badge="Preview"
          testId={`social-preview-${method.id}`}
        />
      ))}
      <PreviewMethodButton
        method={PASSKEY_PREVIEW_METHOD}
        badge="Soon"
        testId="passkey-preview"
      />
    </>
  );
}

/**
 * A method as it will sit in the picker: the same full-width outline pill
 * every real method gets. Inert, and honest about it — the badge says why,
 * and the button declines the click.
 */
function PreviewMethodButton({
  method,
  badge,
  testId,
}: {
  method: SignInMethod;
  badge: string;
  testId: string;
}) {
  return (
    <Button
      variant="outline"
      width="full"
      minHeight="44px"
      fontSize="14px"
      fontWeight={600}
      borderRadius={SHAPE.action}
      justifyContent="center"
      gap="9px"
      disabled
      _disabled={{ opacity: 0.75, cursor: "not-allowed" }}
      data-testid={testId}
    >
      <SignInMethodIcon method={method} />
      <Text>{signInMethodActionLabel(method)}</Text>
      <Badge
        borderRadius="full"
        paddingX="8px"
        fontSize="10px"
        fontWeight={500}
        backgroundColor={BRAND.tint}
        color={BRAND.ink}
      >
        {badge}
      </Badge>
    </Button>
  );
}
