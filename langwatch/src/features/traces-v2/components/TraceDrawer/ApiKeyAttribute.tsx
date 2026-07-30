import { HStack, Icon, Text } from "@chakra-ui/react";
import { Key } from "lucide-react";
import { Link } from "~/components/ui/link";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { apiKeySettingsHref } from "~/pages/settings/api-keys/apiKeyAnchor";
import { api } from "~/utils/api";
import { useIsReadOnlyTrace } from "../../context/TraceViewerContext";

/**
 * Resource attribute the ingestion receiver stamps on every authenticated
 * request, carrying the id of the ApiKey row that authenticated it.
 */
export const API_KEY_ID_ATTRIBUTE = "langwatch.api_key.id";

/** Row label for the attribute: the trailing `.id` is plumbing. */
export const API_KEY_ATTRIBUTE_LABEL = "langwatch.api_key";

/**
 * Value cell for `langwatch.api_key.id`. The stored value is an ApiKey row id,
 * which tells an operator nothing, so the cell resolves it to the key's name
 * and links to that key on the API keys settings page.
 *
 * The name comes from `apiKey.nameById`, which answers for any member of the
 * organization. A deleted key, a key from another organization, or a shared
 * read-only view resolves to nothing and the cell falls back to the raw id
 * rather than rendering a dead link. A revoked key still resolves by name: the
 * trace it authorized is still readable, so naming it is still useful.
 */
export function ApiKeyAttributeValue({ apiKeyId }: { apiKeyId: string }) {
  const { organization } = useOrganizationTeamProject();
  const isReadOnly = useIsReadOnlyTrace();
  const organizationId = organization?.id ?? "";

  const { data } = api.apiKey.nameById.useQuery(
    { organizationId, apiKeyId },
    {
      enabled: !!organizationId && !!apiKeyId && !isReadOnly,
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      retry: false,
    },
  );

  const name = data?.name;

  if (!name) {
    return (
      <Text
        flex={1}
        textStyle="xs"
        fontFamily="mono"
        color="fg"
        truncate
        minWidth={0}
        paddingX={3}
        paddingY={1.5}
      >
        {apiKeyId}
      </Text>
    );
  }

  return (
    <Link
      href={apiKeySettingsHref(apiKeyId)}
      variant="plain"
      flex={1}
      minWidth={0}
      overflow="hidden"
    >
      <HStack gap={1.5} minWidth={0} paddingX={3} paddingY={1.5}>
        <Icon as={Key} boxSize={3} color="fg.subtle" flexShrink={0} />
        <Text textStyle="xs" fontFamily="mono" color="blue.fg" truncate>
          {name}
        </Text>
      </HStack>
    </Link>
  );
}
