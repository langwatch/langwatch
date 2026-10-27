import { Link } from "@langwatch/browser-host/link";
import { Button, HStack, Text } from "@langwatch/design-system/primitives";

export type SecretReferenceLineProps = {
  name: string;
  /** Clears the reference to an empty input. Left out, the credential cannot be replaced here. */
  onReplace?: () => void;
};

/** A credential kept as a project secret: its name, where to manage it, and how to replace it. */
export function SecretReferenceLine({ name, onReplace }: SecretReferenceLineProps) {
  return (
    <HStack gap={2} width="full" fontSize="sm" color="fg.muted" data-testid="secret-reference">
      <Text>Stored as project secret {name}</Text>
      <Link href="/settings/secrets" color="blue.fg" data-testid="secret-reference-link">
        Secrets
      </Link>
      {onReplace && (
        <Button
          size="xs"
          variant="outline"
          onClick={onReplace}
          data-testid="secret-reference-replace"
        >
          Replace
        </Button>
      )}
    </HStack>
  );
}
