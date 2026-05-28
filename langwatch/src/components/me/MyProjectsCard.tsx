import {
  Box,
  Heading,
  HStack,
  SimpleGrid,
  Skeleton,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ChevronRight, FolderOpen } from "lucide-react";
import Link from "~/utils/compat/next-link";

import { api } from "~/utils/api";

interface Props {
  organizationId: string;
  /** Max rows to render. Defaults to 5 (also enforced server-side). */
  limit?: number;
}

/**
 * Persona-2 enrichment card. Shown on /me for users who have project
 * memberships AND personal context — surfaces a quick path back into
 * project work (most-recently-touched first) without leaving the
 * personal home. Hidden entirely for Persona-1 (no projects) and not
 * rendered for Persona-3 (whose home is /[project]/messages).
 *
 * Spec: specs/ai-gateway/governance/persona-home-content.feature
 *       (Mixed-persona home additionally renders the user's projects card)
 */
export function MyProjectsCard({ organizationId, limit = 5 }: Props) {
  const projectsQuery = api.user.userProjects.useQuery(
    { organizationId, limit },
    { enabled: !!organizationId, refetchOnWindowFocus: false },
  );

  if (projectsQuery.isLoading) {
    return (
      <Box
        borderWidth="1px"
        borderColor="border.muted"
        borderRadius="md"
        padding={4}
      >
        <VStack align="start" gap={3}>
          <Skeleton height="16px" width="120px" />
          <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} gap={3} width="full">
            {Array.from({ length: 3 }).map((_, idx) => (
              <Skeleton key={idx} height="64px" borderRadius="md" />
            ))}
          </SimpleGrid>
        </VStack>
      </Box>
    );
  }

  const rows = projectsQuery.data ?? [];
  if (rows.length === 0) return null;

  return (
    <VStack align="stretch" gap={3} width="full">
      <Heading as="h3" size="sm" color="fg.muted">
        Your projects
      </Heading>
      <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} gap={3}>
        {rows.map((p) => (
          <Link
            key={p.id}
            href={`/${p.slug}/messages`}
            style={{ textDecoration: "none" }}
          >
            <Box
              borderWidth="1px"
              borderColor="border.muted"
              borderRadius="md"
              padding={4}
              _hover={{ backgroundColor: "bg.subtle" }}
              cursor="pointer"
              transition="background-color 0.1s"
            >
              <HStack gap={3} alignItems="start">
                <Box marginTop={1}>
                  <FolderOpen size={20} aria-hidden="true" />
                </Box>
                <VStack align="start" gap={0} flex={1} minWidth={0}>
                  <Text fontSize="sm" fontWeight="semibold" truncate>
                    {p.name}
                  </Text>
                  <Text fontSize="xs" color="fg.muted" truncate>
                    {p.teamName}
                  </Text>
                </VStack>
                <ChevronRight size={16} aria-hidden="true" />
              </HStack>
            </Box>
          </Link>
        ))}
      </SimpleGrid>
    </VStack>
  );
}
