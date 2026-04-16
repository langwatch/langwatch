import {
  Box,
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
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { Currency, PricingModel } from "@prisma/client";
import { MoreVertical, Pencil } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useDebounce } from "use-debounce";
import { useRouter } from "~/utils/compat/next-router";
import { Drawer } from "~/components/ui/drawer";
import { Menu } from "~/components/ui/menu";
import { Switch } from "~/components/ui/switch";
import { toaster } from "~/components/ui/toaster";
import {
  BackofficeTable,
  EmptyCell,
  dateInputToISO,
  formatDate,
} from "../BackofficeTable";
import {
  useAdminList,
  useAdminUpdate,
} from "../useAdminResource";

/**
 * Read-facing Organization shape — intentionally does NOT include
 * elasticsearchNodeUrl / elasticsearchApiKey / s3Endpoint / s3AccessKeyId /
 * s3SecretAccessKey / s3Bucket. Those are credentials and the admin Hono
 * route strips them from every list / getOne response (see
 * ee/admin/safeSelects.ts). The edit drawer still accepts *new* values for
 * those fields, write-only.
 */
interface AdminOrganization {
  id: string;
  name: string;
  slug: string;
  phoneNumber: string | null;
  ssoDomain: string | null;
  ssoProvider: string | null;
  usageSpendingMaxLimit: number | null;
  signedDPA: boolean;
  promoCode: string | null;
  stripeCustomerId: string | null;
  currency: Currency;
  pricingModel: PricingModel;
  license: string | null;
  licenseExpiresAt: string | null;
  useCustomElasticsearch: boolean;
  useCustomS3: boolean;
  createdAt: string;
}

const PAGE_SIZE = 25;

export default function OrganizationsView() {
  const router = useRouter();
  // `q` deep-links from other Backoffice pages (e.g. clicking an org chip on
  // the Users table lands here with ?q=<orgId>). Seed once on mount so the
  // list comes up pre-filtered without fighting the user's subsequent typing.
  const initialQueryRef = useRef<string>(
    typeof router.query.q === "string" ? router.query.q : "",
  );
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(initialQueryRef.current);
  const [debouncedSearch] = useDebounce(search, 300);
  const [editing, setEditing] = useState<AdminOrganization | null>(null);

  const list = useAdminList<AdminOrganization>("organization", {
    pagination: { page, perPage: PAGE_SIZE },
    sort: { field: "createdAt", order: "DESC" },
    filter: debouncedSearch ? { query: debouncedSearch } : {},
  });

  return (
    <>
      <BackofficeTable
        title="Organizations"
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
              <Table.ColumnHeader>Plan model</Table.ColumnHeader>
              <Table.ColumnHeader>Currency</Table.ColumnHeader>
              <Table.ColumnHeader>SSO domain</Table.ColumnHeader>
              <Table.ColumnHeader>Created</Table.ColumnHeader>
              <Table.ColumnHeader width="60px" textAlign="right" />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {list.data?.data.length === 0 && (
              <Table.Row>
                <Table.Cell colSpan={8}>
                  <Text color="fg.muted" textAlign="center" paddingY={6}>
                    No organizations match your search.
                  </Text>
                </Table.Cell>
              </Table.Row>
            )}
            {list.data?.data.map((org) => (
              <Table.Row key={org.id}>
                <Table.Cell fontSize="xs" color="fg.muted">
                  {org.id}
                </Table.Cell>
                <Table.Cell>{org.name}</Table.Cell>
                <Table.Cell>{org.slug}</Table.Cell>
                <Table.Cell>{org.pricingModel}</Table.Cell>
                <Table.Cell>{org.currency}</Table.Cell>
                <Table.Cell>
                  {org.ssoDomain ?? <EmptyCell />}
                </Table.Cell>
                <Table.Cell>{formatDate(org.createdAt)}</Table.Cell>
                <Table.Cell textAlign="right">
                  <Box
                    width="full"
                    height="full"
                    display="flex"
                    justifyContent="end"
                  >
                    <Menu.Root>
                      <Menu.Trigger>
                        <MoreVertical size={16} />
                      </Menu.Trigger>
                      <Menu.Content>
                        <Menu.Item
                          value="edit"
                          onClick={() => setEditing(org)}
                        >
                          <Pencil size={16} />
                          Edit
                        </Menu.Item>
                      </Menu.Content>
                    </Menu.Root>
                  </Box>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </BackofficeTable>

      <OrganizationEditDrawer
        organization={editing}
        onClose={() => setEditing(null)}
      />
    </>
  );
}

interface FormState {
  name: string;
  slug: string;
  phoneNumber: string;
  ssoDomain: string;
  ssoProvider: string;
  usageSpendingMaxLimit: string;
  signedDPA: boolean;
  promoCode: string;
  stripeCustomerId: string;
  currency: Currency;
  pricingModel: PricingModel;
  license: string;
  licenseExpiresAt: string;
  useCustomElasticsearch: boolean;
  elasticsearchNodeUrl: string;
  elasticsearchApiKey: string;
  useCustomS3: boolean;
  s3Endpoint: string;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
  s3Bucket: string;
}

function toDateInputValue(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function numOrNull(raw: string): number | null {
  if (raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function nullIfEmpty(raw: string): string | null {
  return raw.trim() === "" ? null : raw;
}

function OrganizationEditDrawer({
  organization,
  onClose,
}: {
  organization: AdminOrganization | null;
  onClose: () => void;
}) {
  const update = useAdminUpdate<AdminOrganization>("organization");
  const [form, setForm] = useState<FormState | null>(null);

  useEffect(() => {
    if (!organization) return;
    setForm({
      name: organization.name ?? "",
      slug: organization.slug ?? "",
      phoneNumber: organization.phoneNumber ?? "",
      ssoDomain: organization.ssoDomain ?? "",
      ssoProvider: organization.ssoProvider ?? "",
      usageSpendingMaxLimit:
        organization.usageSpendingMaxLimit?.toString() ?? "",
      signedDPA: !!organization.signedDPA,
      promoCode: organization.promoCode ?? "",
      stripeCustomerId: organization.stripeCustomerId ?? "",
      currency: organization.currency,
      pricingModel: organization.pricingModel,
      license: organization.license ?? "",
      licenseExpiresAt: toDateInputValue(organization.licenseExpiresAt),
      useCustomElasticsearch: !!organization.useCustomElasticsearch,
      useCustomS3: !!organization.useCustomS3,
      // Credentials are write-only: the server doesn't echo them back in
      // list/getOne responses (see ee/admin/safeSelects.ts), so the form
      // always starts empty. A non-empty value on save is the user typing
      // a *new* secret; an empty value is left unchanged.
      elasticsearchNodeUrl: "",
      elasticsearchApiKey: "",
      s3Endpoint: "",
      s3AccessKeyId: "",
      s3SecretAccessKey: "",
      s3Bucket: "",
    });
  }, [organization]);

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));

  const handleSave = () => {
    if (!organization || !form) return;
    const data: Record<string, unknown> = {};
    if (form.name !== organization.name) data.name = form.name;
    if (form.slug !== organization.slug) data.slug = form.slug;
    if (form.phoneNumber !== (organization.phoneNumber ?? ""))
      data.phoneNumber = nullIfEmpty(form.phoneNumber);
    if (form.ssoDomain !== (organization.ssoDomain ?? ""))
      data.ssoDomain = nullIfEmpty(form.ssoDomain);
    if (form.ssoProvider !== (organization.ssoProvider ?? ""))
      data.ssoProvider = nullIfEmpty(form.ssoProvider);
    const nextLimit = numOrNull(form.usageSpendingMaxLimit);
    if (nextLimit !== organization.usageSpendingMaxLimit) {
      data.usageSpendingMaxLimit = nextLimit;
    }
    if (form.signedDPA !== !!organization.signedDPA)
      data.signedDPA = form.signedDPA;
    if (form.promoCode !== (organization.promoCode ?? ""))
      data.promoCode = nullIfEmpty(form.promoCode);
    if (form.stripeCustomerId !== (organization.stripeCustomerId ?? ""))
      data.stripeCustomerId = nullIfEmpty(form.stripeCustomerId);
    if (form.currency !== organization.currency) data.currency = form.currency;
    if (form.pricingModel !== organization.pricingModel)
      data.pricingModel = form.pricingModel;
    if (form.license !== (organization.license ?? ""))
      data.license = nullIfEmpty(form.license);
    const nextExpires = dateInputToISO(form.licenseExpiresAt);
    if (nextExpires !== organization.licenseExpiresAt) {
      data.licenseExpiresAt = nextExpires;
    }
    if (
      form.useCustomElasticsearch !== !!organization.useCustomElasticsearch
    ) {
      data.useCustomElasticsearch = form.useCustomElasticsearch;
    }
    if (form.useCustomS3 !== !!organization.useCustomS3)
      data.useCustomS3 = form.useCustomS3;
    // Credentials are write-only — the form starts empty and the server
    // never echoes the stored value. Only forward fields the user typed
    // into; an empty input is treated as "leave the stored secret alone".
    if (form.elasticsearchNodeUrl.trim() !== "") {
      data.elasticsearchNodeUrl = form.elasticsearchNodeUrl;
    }
    if (form.elasticsearchApiKey.trim() !== "") {
      data.elasticsearchApiKey = form.elasticsearchApiKey;
    }
    if (form.s3Endpoint.trim() !== "") data.s3Endpoint = form.s3Endpoint;
    if (form.s3AccessKeyId.trim() !== "")
      data.s3AccessKeyId = form.s3AccessKeyId;
    if (form.s3SecretAccessKey.trim() !== "")
      data.s3SecretAccessKey = form.s3SecretAccessKey;
    if (form.s3Bucket.trim() !== "") data.s3Bucket = form.s3Bucket;

    if (Object.keys(data).length === 0) {
      onClose();
      return;
    }
    update.mutate(
      { id: organization.id, data },
      {
        onSuccess: () => {
          toaster.create({
            title: "Organization updated",
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
      open={!!organization}
      onOpenChange={({ open }) => {
        if (!open) onClose();
      }}
      size="md"
    >
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>Edit Organization</Drawer.Title>
        </Drawer.Header>
        <Drawer.CloseTrigger />
        <Drawer.Body>
          {organization && form && (
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
              <Field.Root>
                <Field.Label>Phone number</Field.Label>
                <Input
                  type="tel"
                  value={form.phoneNumber}
                  onChange={(e) => setField("phoneNumber", e.target.value)}
                />
              </Field.Root>

              <SectionHeading>Billing</SectionHeading>
              <HStack gap={3} align="start">
                <Field.Root>
                  <Field.Label>Currency</Field.Label>
                  <EnumSelect
                    value={form.currency}
                    options={Object.values(Currency)}
                    onChange={(v) => setField("currency", v as Currency)}
                  />
                </Field.Root>
                <Field.Root>
                  <Field.Label>Pricing model</Field.Label>
                  <EnumSelect
                    value={form.pricingModel}
                    options={Object.values(PricingModel)}
                    onChange={(v) =>
                      setField("pricingModel", v as PricingModel)
                    }
                  />
                </Field.Root>
              </HStack>
              <Field.Root>
                <Field.Label>Stripe customer ID</Field.Label>
                <Input
                  value={form.stripeCustomerId}
                  onChange={(e) =>
                    setField("stripeCustomerId", e.target.value)
                  }
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>Promo code</Field.Label>
                <Input
                  value={form.promoCode}
                  onChange={(e) => setField("promoCode", e.target.value)}
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>Usage spending max limit</Field.Label>
                <Input
                  type="number"
                  value={form.usageSpendingMaxLimit}
                  onChange={(e) =>
                    setField("usageSpendingMaxLimit", e.target.value)
                  }
                  placeholder="Leave empty for no cap"
                />
              </Field.Root>
              <ToggleRow
                label="Signed DPA"
                hint="Enterprise data processing agreement on file."
                checked={form.signedDPA}
                onChange={(v) => setField("signedDPA", v)}
              />

              <SectionHeading>Authentication</SectionHeading>
              <Field.Root>
                <Field.Label>SSO domain</Field.Label>
                <Input
                  value={form.ssoDomain}
                  onChange={(e) => setField("ssoDomain", e.target.value)}
                  placeholder="e.g. acme.com"
                />
                <Field.HelperText>
                  Lowercased server-side. Users with this email domain can
                  sign in via SSO.
                </Field.HelperText>
              </Field.Root>
              <Field.Root>
                <Field.Label>SSO provider</Field.Label>
                <Input
                  value={form.ssoProvider}
                  onChange={(e) => setField("ssoProvider", e.target.value)}
                />
              </Field.Root>

              <SectionHeading>License</SectionHeading>
              <Field.Root>
                <Field.Label>License key</Field.Label>
                <Textarea
                  rows={4}
                  value={form.license}
                  onChange={(e) => setField("license", e.target.value)}
                  fontFamily="mono"
                  fontSize="xs"
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>License expires at</Field.Label>
                <Input
                  type="date"
                  value={form.licenseExpiresAt}
                  onChange={(e) =>
                    setField("licenseExpiresAt", e.target.value)
                  }
                />
              </Field.Root>

              <SectionHeading>Custom Elasticsearch</SectionHeading>
              <Text fontSize="xs" color="fg.muted">
                Credentials below are write-only — the server never reads them
                back. Leave blank to keep the stored value; type to replace.
              </Text>
              <ToggleRow
                label="Use custom Elasticsearch"
                hint="Override the platform-managed ClickHouse/ES cluster for this tenant."
                checked={form.useCustomElasticsearch}
                onChange={(v) => setField("useCustomElasticsearch", v)}
              />
              <Field.Root>
                <Field.Label>Node URL</Field.Label>
                <Input
                  type="url"
                  value={form.elasticsearchNodeUrl}
                  onChange={(e) =>
                    setField("elasticsearchNodeUrl", e.target.value)
                  }
                  placeholder="Leave blank to keep current"
                  disabled={!form.useCustomElasticsearch}
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>API key</Field.Label>
                <Input
                  type="password"
                  value={form.elasticsearchApiKey}
                  onChange={(e) =>
                    setField("elasticsearchApiKey", e.target.value)
                  }
                  placeholder="Leave blank to keep current"
                  disabled={!form.useCustomElasticsearch}
                  autoComplete="new-password"
                />
              </Field.Root>

              <SectionHeading>Custom S3</SectionHeading>
              <Text fontSize="xs" color="fg.muted">
                Credentials below are write-only — the server never reads them
                back. Leave blank to keep the stored value; type to replace.
              </Text>
              <ToggleRow
                label="Use custom S3"
                hint="Store large blobs (datasets, uploads) in the tenant's own bucket."
                checked={form.useCustomS3}
                onChange={(v) => setField("useCustomS3", v)}
              />
              <Field.Root>
                <Field.Label>Endpoint</Field.Label>
                <Input
                  type="url"
                  value={form.s3Endpoint}
                  onChange={(e) => setField("s3Endpoint", e.target.value)}
                  placeholder="Leave blank to keep current"
                  disabled={!form.useCustomS3}
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>Bucket</Field.Label>
                <Input
                  value={form.s3Bucket}
                  onChange={(e) => setField("s3Bucket", e.target.value)}
                  placeholder="Leave blank to keep current"
                  disabled={!form.useCustomS3}
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>Access key ID</Field.Label>
                <Input
                  type="password"
                  value={form.s3AccessKeyId}
                  onChange={(e) => setField("s3AccessKeyId", e.target.value)}
                  placeholder="Leave blank to keep current"
                  disabled={!form.useCustomS3}
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
                  disabled={!form.useCustomS3}
                />
              </Field.Root>

              <Separator my={2} />
              <VStack align="start" gap={0}>
                <Text fontSize="xs" color="fg.muted">
                  Organization ID: {organization.id}
                </Text>
                <Text fontSize="xs" color="fg.muted">
                  Created: {formatDate(organization.createdAt)}
                </Text>
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
