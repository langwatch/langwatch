import { useState, useMemo } from "react";
import { Box, Flex, Text, VStack } from "@chakra-ui/react";
import { ChevronDown, Check } from "lucide-react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useFoundryProjectStore } from "./foundryProjectStore";

export function ConnectionSettings({ compact = false }: { compact?: boolean }) {
  const { project: currentProject } = useOrganizationTeamProject();
  const organizations = api.organization.getAll.useQuery(
    { isDemo: false },
    { staleTime: 60_000 }
  );
  const [isOpen, setIsOpen] = useState(false);

  const { selectedProjectId, setSelectedProject } = useFoundryProjectStore();

  const allProjects = useMemo(() => {
    if (!organizations.data) return [];
    return organizations.data.flatMap((org) =>
      org.teams.flatMap((team) =>
        team.projects.map((project) => ({
          id: project.id,
          name: project.name,
          slug: project.slug,
          apiKey: project.apiKey,
          orgName: org.name,
          teamName: team.name,
        }))
      )
    );
  }, [organizations.data]);

  // Default to current project if nothing selected
  const selectedProject = selectedProjectId
    ? allProjects.find((p) => p.id === selectedProjectId)
    : allProjects.find((p) => p.id === currentProject?.id) ?? allProjects[0];

  return (
    <Box p={3}>
      <Text
        fontSize="xs"
        fontWeight="medium"
        textTransform="uppercase"
        letterSpacing="wider"
        color="fg.muted"
        mb={2}
      >
        Target Project
      </Text>
      <Box position="relative">
        <Flex
          as="button"
          w="full"
          align="center"
          gap={2}
          rounded="md"
          border="1px solid"
          borderColor="border"
          px={2}
          py={1.5}
          cursor="pointer"
          _hover={{ bg: "bg.subtle" }}
          onClick={() => setIsOpen(!isOpen)}
        >
          <Box w={2} h={2} rounded="full" bg={selectedProject ? "green.400" : "gray.500"} flexShrink={0} />
          <VStack align="start" gap={0} flex={1} minW={0}>
            <Text fontSize="xs" color="fg.default" truncate w="full" textAlign="left">
              {selectedProject?.name ?? "Select a project"}
            </Text>
            {selectedProject && !compact && (
              <Text fontSize="10px" color="fg.muted" truncate w="full" textAlign="left">
                {selectedProject.orgName}
              </Text>
            )}
          </VStack>
          <ChevronDown size={12} color="var(--chakra-colors-fg-muted)" />
        </Flex>

        {isOpen && (
          <>
            <Box position="fixed" inset={0} zIndex={40} onClick={() => setIsOpen(false)} />
            <Box
              position="absolute"
              left={0}
              right={0}
              zIndex={50}
              mt={1}
              maxH="300px"
              overflow="auto"
              rounded="lg"
              border="1px solid"
              borderColor="border"
              bg="bg.panel"
              shadow="lg"
            >
              {allProjects.length === 0 ? (
                <Box px={3} py={2}>
                  <Text fontSize="xs" color="fg.muted">No projects found</Text>
                </Box>
              ) : (
                <ProjectList
                  projects={allProjects}
                  selectedId={selectedProject?.id}
                  onSelect={(project) => {
                    setSelectedProject(project.id, project.apiKey);
                    setIsOpen(false);
                  }}
                />
              )}
            </Box>
          </>
        )}
      </Box>
    </Box>
  );
}

function ProjectList({
  projects,
  selectedId,
  onSelect,
}: {
  projects: Array<{ id: string; name: string; slug: string; apiKey: string; orgName: string; teamName: string }>;
  selectedId: string | undefined;
  onSelect: (project: { id: string; apiKey: string }) => void;
}) {
  // Group by org
  const grouped = useMemo(() => {
    const map = new Map<string, typeof projects>();
    for (const p of projects) {
      const list = map.get(p.orgName) ?? [];
      list.push(p);
      map.set(p.orgName, list);
    }
    return map;
  }, [projects]);

  return (
    <VStack align="stretch" gap={0} py={1}>
      {[...grouped.entries()].map(([orgName, orgProjects]) => (
        <Box key={orgName}>
          <Text fontSize="10px" fontWeight="medium" color="fg.muted" textTransform="uppercase" letterSpacing="wider" px={3} py={1}>
            {orgName}
          </Text>
          {orgProjects.map((project) => (
            <Flex
              key={project.id}
              as="button"
              w="full"
              align="center"
              gap={2}
              px={3}
              py={1.5}
              _hover={{ bg: "bg.subtle" }}
              onClick={() => onSelect(project)}
            >
              {selectedId === project.id ? (
                <Check size={12} color="var(--chakra-colors-green-400)" />
              ) : (
                <Box w={3} />
              )}
              <Text fontSize="xs" color="fg.default" flex={1} textAlign="left" truncate>
                {project.name}
              </Text>
              <Text fontSize="10px" color="fg.muted" fontFamily="mono">
                {project.slug}
              </Text>
            </Flex>
          ))}
        </Box>
      ))}
    </VStack>
  );
}
