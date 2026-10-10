import { Box, createListCollection, Field, Text } from "@langwatch/design-system/primitives";
import { Select } from "@langwatch/design-system/select";

import { useFoundryProjectStore } from "../../behavior/foundry-project.store.ts";
import { useFoundryTransport } from "../../behavior/foundry-runtime.tsx";
import { useTargetProject } from "../../behavior/use-target-project.ts";

export function ConnectionSettings({ compact = false }: { compact?: boolean }) {
  const { projects } = useFoundryTransport();
  const setSelectedProject = useFoundryProjectStore((s) => s.setSelectedProject);
  const selectedProject = useTargetProject();
  const collection = createListCollection({
    items: projects.map((project) => ({
      label: `${project.name} · ${project.orgName}`,
      value: project.id,
    })),
  });

  return (
    <Box p={4}>
      <Field.Root>
        <Field.Label>Target project</Field.Label>
        <Select.Root
          size="sm"
          collection={collection}
          value={selectedProject ? [selectedProject.id] : []}
          onValueChange={({ value }) => {
            if (value[0]) setSelectedProject(value[0]);
          }}
        >
          <Select.Trigger aria-label="Target project">
            <Select.ValueText placeholder="Select a project" />
          </Select.Trigger>
          <Select.Content>
            {collection.items.map((item) => (
              <Select.Item key={item.value} item={item}>
                {item.label}
              </Select.Item>
            ))}
            {projects.length === 0 && (
              <Text p={3} fontSize="sm" color="fg.muted">
                No projects found
              </Text>
            )}
          </Select.Content>
        </Select.Root>
        {!compact && (
          <Field.HelperText>Generated traces are sent to this project.</Field.HelperText>
        )}
      </Field.Root>
    </Box>
  );
}
