import { Link } from "@langwatch/browser-host/link";
import { Checkbox } from "@langwatch/design-system/checkbox";
import { Text, VStack } from "@langwatch/design-system/primitives";

const SECRETS_ROUTE = "/settings/secrets";

/**
 * The project secrets the blocks may read; a name saved earlier stays listed after its secret
 * goes. No Field.Root: it would hand every checkbox the one field id.
 */
export function ConnectorSecretsField({
  projectSecretNames,
  secretNames,
  error,
  onChange,
}: {
  projectSecretNames: readonly string[];
  secretNames: readonly string[];
  error: string | undefined;
  onChange: (secretNames: readonly string[]) => void;
}) {
  const names = [...new Set([...projectSecretNames, ...secretNames])].toSorted();
  const toggle = (name: string, checked: boolean) =>
    onChange(checked ? [...secretNames, name] : secretNames.filter((picked) => picked !== name));

  return (
    <VStack align="stretch" gap={1.5} data-testid="connector-secrets-field">
      <Text textStyle="bodySm" fontWeight="medium">
        Secrets
      </Text>
      <Text textStyle="bodySm" color="fg.muted">
        Only the secrets picked here reach the blocks, as secrets.NAME. Manage them in{" "}
        <Link href={SECRETS_ROUTE} target="_blank" rel="noopener noreferrer">
          Settings &gt; Secrets
        </Link>
        .
      </Text>
      {names.length === 0 ? (
        <Text textStyle="bodySm" color="fg.muted">
          This project has no secrets yet.
        </Text>
      ) : (
        <VStack align="start" gap={1}>
          {names.map((name) => (
            <Checkbox
              key={name}
              checked={secretNames.includes(name)}
              onCheckedChange={({ checked }) => toggle(name, checked === true)}
            >
              {name}
            </Checkbox>
          ))}
        </VStack>
      )}
      {error && (
        <Text textStyle="bodySm" color="fg.error" role="alert">
          {error}
        </Text>
      )}
    </VStack>
  );
}
