import { HStack, Icon, Text } from "@chakra-ui/react";
import { Key } from "lucide-react";
import { Link } from "../../../blocks/link";
import { useOrganizationTeamProject } from "../../../../behavior/use-organization-team-project";
import { apiKeySettingsHref } from "../../../../model/api-key-anchor";
import { api } from "../../trace-api";
import { useIsReadOnlyTrace } from "../../../elements/explorer/context/trace-viewer-context";

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
    // `display="flex"` rather than `flex={1}`: the cell this sits in is a
    // block box, so a flex-grow on this element would be inert and the link,
    // being inline-flex by default, would shrink-to-fit its own text and
    // overrun the column. Block-level flex fills the cell instead, which is
    // what lets the name below truncate.
    <Link
      href={apiKeySettingsHref(apiKeyId)}
      variant="plain"
      display="flex"
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
