import {
  Badge,
  Button,
  Field,
  Heading,
  HStack,
  Input,
  NativeSelect,
  Separator,
  Spacer,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  PIIRedactionLevel,
  ProjectSensitiveDataVisibilityLevel,
} from "@prisma/client";
import { Pencil } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useDebounce } from "use-debounce";
import { useRouter } from "~/utils/compat/next-router";
import { Drawer } from "~/components/ui/drawer";
import { Switch } from "~/components/ui/switch";
import { toaster } from "~/components/ui/toaster";
import {
  BackofficeTable,
  EmptyCell,
  formatDate,
} from "../BackofficeTable";
import {
  useAdminList,
  useAdminUpdate,
} from "../useAdminResource";

/**
 * Read-facing Project shape — does NOT include s3Endpoint / s3AccessKeyId /
 * s3SecretAccessKey / s3Bucket. Project-level S3 overrides are credentials
 * and the admin Hono route strips them from every list / getOne response
 * (see ee/admin/safeSelects.ts). The edit drawer accepts new values,
 * write-only.
 */
interface AdminProject {
  id: string;
  name: string;
  slug: string;
  apiKey: string;
  teamId: string;
  language: string | null;
  framework: string | null;
  firstMessage: boolean;
  integrated: boolean;
  userLinkTemplate: string | null;
  piiRedactionLevel: PIIRedactionLevel;
  capturedInputVisibility: ProjectSensitiveDataVisibilityLevel;
  capturedOutputVisibility: ProjectSensitiveDataVisibilityLevel;
  traceSharingEnabled: boolean;
  defaultModel: string | null;
  topicClusteringModel: string | null;
  embeddingsModel: string | null;
  archivedAt: string | null;
  createdAt: string;
}

const PAGE_SIZE = 25;

export default function ProjectsView() {
  const router = useRouter();
  // Deep-link support: /ops/backoffice/projects?q=<projectId> — seed the
  // search input once from the URL so chips on the Users table drop the user
  // straight onto the matching row.
  const initialQueryRef = useRef<string>(
    typeof router.query.q === "string" ? router.query.q : "",
  );
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(initialQueryRef.current);
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
              <Table.ColumnHeader>PII</Table.ColumnHeader>
              <Table.ColumnHeader>Status</Table.ColumnHeader>
              <Table.ColumnHeader>Created</Table.ColumnHeader>
              <Table.ColumnHeader width="100px" textAlign="right">
                Actions
              </Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {list.data?.data.length === 0 && (
              <Table.Row>
                <Table.Cell colSpan={9}>
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
                <Table.Cell>{project.language ?? <EmptyCell />}</Table.Cell>
                <Table.Cell>{project.framework ?? <EmptyCell />}</Table.Cell>
                <Table.Cell>
                  <Badge size="sm" variant="subtle">
                    {project.piiRedactionLevel}
                  </Badge>
                </Table.Cell>
                <Table.Cell>
                  {project.archivedAt ? (
                    <Badge size="sm" colorPalette="gray">
                      Archived
                    </Badge>
                  ) : project.integrated ? (
                    <Badge size="sm" colorPalette="green">
                      Integrated
                    </Badge>
                  ) : (
                    <Badge size="sm" colorPalette="yellow">
                      Pending
                    </Badge>
                  )}
                </Table.Cell>
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

interface FormState {
  name: string;
  slug: string;
  language: string;
  framework: string;
  firstMessage: boolean;
  integrated: boolean;
  userLinkTemplate: string;
  piiRedactionLevel: PIIRedactionLevel;
  capturedInputVisibility: ProjectSensitiveDataVisibilityLevel;
  capturedOutputVisibility: ProjectSensitiveDataVisibilityLevel;
  traceSharingEnabled: boolean;
  defaultModel: string;
  topicClusteringModel: string;
  embeddingsModel: string;
  s3Endpoint: string;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
  s3Bucket: string;
  archive: boolean;
}

function nullIfEmpty(raw: string): string | null {
  return raw.trim() === "" ? null : raw;
}

function ProjectEditDrawer({
  project,
  onClose,
}: {
  project: AdminProject | null;
  onClose: () => void;
}) {
  const update = useAdminUpdate<AdminProject>("project");
  const [form, setForm] = useState<FormState | null>(null);

  useEffect(() => {
    if (!project) return;
    setForm({
      name: project.name,
      slug: project.slug,
      language: project.language ?? "",
      framework: project.framework ?? "",
      firstMessage: !!project.firstMessage,
      integrated: !!project.integrated,
      userLinkTemplate: project.userLinkTemplate ?? "",
      piiRedactionLevel: project.piiRedactionLevel,
      capturedInputVisibility: project.capturedInputVisibility,
      capturedOutputVisibility: project.capturedOutputVisibility,
      traceSharingEnabled: !!project.traceSharingEnabled,
      defaultModel: project.defaultModel ?? "",
      topicClusteringModel: project.topicClusteringModel ?? "",
      embeddingsModel: project.embeddingsModel ?? "",
      // S3 credentials are write-only: the server strips them from
      // read payloads (ee/admin/safeSelects.ts), so the form always
      // starts empty. Typing a value replaces the stored secret;
      // leaving it blank keeps the current one untouched.
      s3Endpoint: "",
      s3AccessKeyId: "",
      s3SecretAccessKey: "",
      s3Bucket: "",
      archive: !!project.archivedAt,
    });
  }, [project]);

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));

  const handleSave = () => {
    if (!project || !form) return;
    const data: Record<string, unknown> = {};

    if (form.name !== project.name) data.name = form.name;
    if (form.slug !== project.slug) data.slug = form.slug;
    if (form.language !== (project.language ?? ""))
      data.language = form.language;
    if (form.framework !== (project.framework ?? ""))
      data.framework = form.framework;
    if (form.firstMessage !== !!project.firstMessage)
      data.firstMessage = form.firstMessage;
    if (form.integrated !== !!project.integrated)
      data.integrated = form.integrated;
    if (form.userLinkTemplate !== (project.userLinkTemplate ?? ""))
      data.userLinkTemplate = nullIfEmpty(form.userLinkTemplate);
    if (form.piiRedactionLevel !== project.piiRedactionLevel)
      data.piiRedactionLevel = form.piiRedactionLevel;
    if (form.capturedInputVisibility !== project.capturedInputVisibility)
      data.capturedInputVisibility = form.capturedInputVisibility;
    if (form.capturedOutputVisibility !== project.capturedOutputVisibility)
      data.capturedOutputVisibility = form.capturedOutputVisibility;
    if (form.traceSharingEnabled !== !!project.traceSharingEnabled)
      data.traceSharingEnabled = form.traceSharingEnabled;
    if (form.defaultModel !== (project.defaultModel ?? ""))
      data.defaultModel = nullIfEmpty(form.defaultModel);
    if (form.topicClusteringModel !== (project.topicClusteringModel ?? ""))
      data.topicClusteringModel = nullIfEmpty(form.topicClusteringModel);
    if (form.embeddingsModel !== (project.embeddingsModel ?? ""))
      data.embeddingsModel = nullIfEmpty(form.embeddingsModel);
    // Write-only credentials — only forward fields the user typed into;
    // an empty input means "leave the stored secret alone". Nothing we
    // received from the server can be compared against because the
    // server never sends these fields back.
    if (form.s3Endpoint.trim() !== "") data.s3Endpoint = form.s3Endpoint;
    if (form.s3AccessKeyId.trim() !== "")
      data.s3AccessKeyId = form.s3AccessKeyId;
    if (form.s3SecretAccessKey.trim() !== "")
      data.s3SecretAccessKey = form.s3SecretAccessKey;
    if (form.s3Bucket.trim() !== "") data.s3Bucket = form.s3Bucket;
    const currentlyArchived = !!project.archivedAt;
    if (form.archive !== currentlyArchived) {
      data.archivedAt = form.archive
        ? new Date().toISOString()
        : null;
    }

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
          {project && form && (
            <VStack gap={4} align="stretch">
              <SectionHeading>Identity</SectionHeading>
              <Field.Root>
                <Field.Label>Name</Field.Label>
                <Input
                  value={form.name}
                  onChange={(e) => setField("name", e.target.value)}
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>Slug</Field.Label>
                <Input
                  value={form.slug}
                  onChange={(e) => setField("slug", e.target.value)}
                />
                <Field.HelperText>
                  URL-safe identifier. Changing this can break existing links.
                </Field.HelperText>
              </Field.Root>
              <HStack gap={3}>
                <Field.Root>
                  <Field.Label>Language</Field.Label>
                  <Input
                    value={form.language}
                    onChange={(e) => setField("language", e.target.value)}
                  />
                </Field.Root>
                <Field.Root>
                  <Field.Label>Framework</Field.Label>
                  <Input
                    value={form.framework}
                    onChange={(e) => setField("framework", e.target.value)}
                  />
                </Field.Root>
              </HStack>

              <SectionHeading>Onboarding flags</SectionHeading>
              <ToggleRow
                label="First message received"
                hint="Flipped by the collector on the first ingested trace."
                checked={form.firstMessage}
                onChange={(v) => setField("firstMessage", v)}
              />
              <ToggleRow
                label="Integrated"
                hint="Tenant-visible ‘setup complete’ state."
                checked={form.integrated}
                onChange={(v) => setField("integrated", v)}
              />

              <SectionHeading>Privacy</SectionHeading>
              <Field.Root>
                <Field.Label>PII redaction level</Field.Label>
                <EnumSelect
                  value={form.piiRedactionLevel}
                  options={Object.values(PIIRedactionLevel)}
                  onChange={(v) =>
                    setField("piiRedactionLevel", v as PIIRedactionLevel)
                  }
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>Captured input visibility</Field.Label>
                <EnumSelect
                  value={form.capturedInputVisibility}
                  options={Object.values(ProjectSensitiveDataVisibilityLevel)}
                  onChange={(v) =>
                    setField(
                      "capturedInputVisibility",
                      v as ProjectSensitiveDataVisibilityLevel,
                    )
                  }
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>Captured output visibility</Field.Label>
                <EnumSelect
                  value={form.capturedOutputVisibility}
                  options={Object.values(ProjectSensitiveDataVisibilityLevel)}
                  onChange={(v) =>
                    setField(
                      "capturedOutputVisibility",
                      v as ProjectSensitiveDataVisibilityLevel,
                    )
                  }
                />
              </Field.Root>
              <ToggleRow
                label="Trace sharing enabled"
                hint="Allow operators to generate public share links for traces."
                checked={form.traceSharingEnabled}
                onChange={(v) => setField("traceSharingEnabled", v)}
              />

              <SectionHeading>Integrations</SectionHeading>
              <Field.Root>
                <Field.Label>User link template</Field.Label>
                <Input
                  value={form.userLinkTemplate}
                  onChange={(e) =>
                    setField("userLinkTemplate", e.target.value)
                  }
                  placeholder="e.g. https://app.acme.com/users/{{userId}}"
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>Default model</Field.Label>
                <Input
                  value={form.defaultModel}
                  onChange={(e) => setField("defaultModel", e.target.value)}
                  placeholder="e.g. openai/gpt-5-mini"
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>Topic clustering model</Field.Label>
                <Input
                  value={form.topicClusteringModel}
                  onChange={(e) =>
                    setField("topicClusteringModel", e.target.value)
                  }
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>Embeddings model</Field.Label>
                <Input
                  value={form.embeddingsModel}
                  onChange={(e) => setField("embeddingsModel", e.target.value)}
                />
              </Field.Root>

              <SectionHeading>Project S3</SectionHeading>
              <Text fontSize="xs" color="fg.muted">
                Credentials below are write-only — the server never reads them
                back. Leave blank to keep the stored value; type to replace.
              </Text>
              <Field.Root>
                <Field.Label>Endpoint</Field.Label>
                <Input
                  type="url"
                  value={form.s3Endpoint}
                  onChange={(e) => setField("s3Endpoint", e.target.value)}
                  placeholder="Leave blank to keep current"
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>Bucket</Field.Label>
                <Input
                  value={form.s3Bucket}
                  onChange={(e) => setField("s3Bucket", e.target.value)}
                  placeholder="Leave blank to keep current"
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>Access key ID</Field.Label>
                <Input
                  type="password"
                  value={form.s3AccessKeyId}
                  onChange={(e) => setField("s3AccessKeyId", e.target.value)}
                  placeholder="Leave blank to keep current"
                  autoComplete="new-password"
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>Secret access key</Field.Label>
                <Input
                  type="password"
                  value={form.s3SecretAccessKey}
                  onChange={(e) =>
                    setField("s3SecretAccessKey", e.target.value)
                  }
                  placeholder="Leave blank to keep current"
                  autoComplete="new-password"
                />
              </Field.Root>

              <SectionHeading>Lifecycle</SectionHeading>
              <ToggleRow
                label="Archived"
                hint="Hides the project from the UI and stops it from accruing limits."
                checked={form.archive}
                onChange={(v) => setField("archive", v)}
              />

              <Separator my={2} />
              <VStack align="start" gap={0}>
                <Text fontSize="xs" color="fg.muted">
                  Project ID: {project.id}
                </Text>
                <Text fontSize="xs" color="fg.muted">
                  Team: {project.teamId}
                </Text>
                <Text fontSize="xs" color="fg.muted">
                  API key: {project.apiKey}
                </Text>
                {project.archivedAt && (
                  <Text fontSize="xs" color="fg.muted">
                    Archived at: {formatDate(project.archivedAt)}
                  </Text>
                )}
              </VStack>
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

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <Heading
      as="h3"
      size="xs"
      color="fg.muted"
      textTransform="uppercase"
      letterSpacing="wider"
      pt={2}
    >
      {children}
    </Heading>
  );
}

function EnumSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}) {
  return (
    <NativeSelect.Root size="sm" width="full">
      <NativeSelect.Field
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </NativeSelect.Field>
      <NativeSelect.Indicator />
    </NativeSelect.Root>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Field.Root>
      <HStack width="full">
        <VStack align="start" gap={0}>
          <Field.Label>{label}</Field.Label>
          {hint && (
            <Text fontSize="xs" color="fg.muted">
              {hint}
            </Text>
          )}
        </VStack>
        <Spacer />
        <Switch
          checked={checked}
          onCheckedChange={(e) => onChange(e.checked)}
        />
      </HStack>
    </Field.Root>
  );
}
