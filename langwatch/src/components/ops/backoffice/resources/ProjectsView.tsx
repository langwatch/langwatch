import {
  Button,
  Field,
  HStack,
  Input,
  Spacer,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Pencil } from "lucide-react";
import { useEffect, useState } from "react";
import { useDebounce } from "use-debounce";
import { Drawer } from "~/components/ui/drawer";
import { toaster } from "~/components/ui/toaster";
import {
  BackofficeTable,
  formatDate,
} from "~/components/ops/backoffice/BackofficeTable";
import {
  useAdminList,
  useAdminUpdate,
} from "~/components/ops/backoffice/useAdminResource";

interface AdminProject {
  id: string;
  name: string;
  slug: string;
  language: string | null;
  framework: string | null;
  teamId: string;
  createdAt: string;
}

const PAGE_SIZE = 25;

export default function ProjectsView() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 300);
  const [editing, setEditing] = useState<AdminProject | null>(null);

  const list = useAdminList<AdminProject>("project", {
    pagination: { page, perPage: PAGE_SIZE },
    sort: { field: "createdAt", order: "DESC" },
    filter: debouncedSearch ? { query: debouncedSearch } : {},
  });

  return (
    <>
      <BackofficeTable
        title="Projects"
        searchValue={search}
        onSearchChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        searchPlaceholder="Search by ID, name, or slug"
        isLoading={list.isLoading}
        isFetching={list.isFetching}
        error={list.error}
        pagination={{
          page,
          perPage: PAGE_SIZE,
          total: list.data?.total ?? 0,
          onPageChange: setPage,
        }}
      >
        <Table.Root variant="line" size="md" width="full">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>ID</Table.ColumnHeader>
              <Table.ColumnHeader>Name</Table.ColumnHeader>
              <Table.ColumnHeader>Slug</Table.ColumnHeader>
              <Table.ColumnHeader>Language</Table.ColumnHeader>
              <Table.ColumnHeader>Framework</Table.ColumnHeader>
              <Table.ColumnHeader>Created</Table.ColumnHeader>
              <Table.ColumnHeader width="100px" textAlign="right">
                Actions
              </Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {list.data?.data.length === 0 && (
              <Table.Row>
                <Table.Cell colSpan={7}>
                  <Text color="fg.muted" textAlign="center" paddingY={6}>
                    No projects match your search.
                  </Text>
                </Table.Cell>
              </Table.Row>
            )}
            {list.data?.data.map((project) => (
              <Table.Row key={project.id}>
                <Table.Cell fontSize="xs" color="fg.muted">
                  {project.id}
                </Table.Cell>
                <Table.Cell>{project.name}</Table.Cell>
                <Table.Cell>{project.slug}</Table.Cell>
                <Table.Cell>{project.language ?? "—"}</Table.Cell>
                <Table.Cell>{project.framework ?? "—"}</Table.Cell>
                <Table.Cell>{formatDate(project.createdAt)}</Table.Cell>
                <Table.Cell textAlign="right">
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => setEditing(project)}
                  >
                    <Pencil size={14} /> Edit
                  </Button>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </BackofficeTable>

      <ProjectEditDrawer
        project={editing}
        onClose={() => setEditing(null)}
      />
    </>
  );
}

function ProjectEditDrawer({
  project,
  onClose,
}: {
  project: AdminProject | null;
  onClose: () => void;
}) {
  const update = useAdminUpdate<AdminProject>("project");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [language, setLanguage] = useState("");
  const [framework, setFramework] = useState("");

  useEffect(() => {
    if (!project) return;
    setName(project.name);
    setSlug(project.slug);
    setLanguage(project.language ?? "");
    setFramework(project.framework ?? "");
  }, [project]);

  const handleSave = () => {
    if (!project) return;
    const data: Record<string, unknown> = {};
    if (name !== project.name) data.name = name;
    if (slug !== project.slug) data.slug = slug;
    if (language !== (project.language ?? "")) data.language = language;
    if (framework !== (project.framework ?? "")) data.framework = framework;
    if (Object.keys(data).length === 0) {
      onClose();
      return;
    }
    update.mutate(
      { id: project.id, data },
      {
        onSuccess: () => {
          toaster.create({
            title: "Project updated",
            type: "success",
            duration: 3000,
            meta: { closable: true },
          });
          onClose();
        },
        onError: (err) =>
          toaster.create({
            title: "Update failed",
            description: err.message,
            type: "error",
            duration: 5000,
            meta: { closable: true },
          }),
      },
    );
  };

  return (
    <Drawer.Root
      open={!!project}
      onOpenChange={({ open }) => {
        if (!open) onClose();
      }}
      size="md"
    >
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>Edit Project</Drawer.Title>
        </Drawer.Header>
        <Drawer.CloseTrigger />
        <Drawer.Body>
          {project && (
            <VStack gap={4} align="stretch">
              <Field.Root>
                <Field.Label>Name</Field.Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>Slug</Field.Label>
                <Input
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                />
                <Field.HelperText>
                  URL-safe identifier. Changing this can break existing links.
                </Field.HelperText>
              </Field.Root>
              <Field.Root>
                <Field.Label>Language</Field.Label>
                <Input
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>Framework</Field.Label>
                <Input
                  value={framework}
                  onChange={(e) => setFramework(e.target.value)}
                />
              </Field.Root>
              <Text fontSize="xs" color="fg.muted">
                Project ID: {project.id} · Team: {project.teamId}
              </Text>
            </VStack>
          )}
        </Drawer.Body>
        <Drawer.Footer>
          <HStack width="full">
            <Spacer />
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button loading={update.isPending} onClick={handleSave}>
              Save
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}
