import {
  Badge,
  Button,
  Field,
  HStack,
  Input,
  NativeSelect,
  SimpleGrid,
  Table,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { MoreVertical } from "lucide-react";
import { useEffect, useState } from "react";
import { useDebounce } from "use-debounce";
import { Dialog } from "~/components/ui/dialog";
import { Drawer } from "~/components/ui/drawer";
import { Menu } from "~/components/ui/menu";
import { toaster } from "~/components/ui/toaster";
import { showErrorToast } from "~/features/errors";
import { api, type RouterOutputs } from "~/utils/api";
import {
  BackofficeTable,
  dateInputToISO,
  EmptyCell,
  formatDate,
  formatDateTime,
} from "../BackofficeTable";

const PAGE_SIZE = 25;
const COLUMN_COUNT = 8;

const SERVICES = ["instant_evals", "managed_models"] as const;
type Service = (typeof SERVICES)[number];
const SERVICE_LABELS: Record<Service, string> = {
  instant_evals: "Instant Evals",
  managed_models: "Managed models",
};

type License = RouterOutputs["licenseRegistry"]["getAll"]["licenses"][number];

/**
 * The backoffice's license registry (ADR-139): every license LangWatch issued,
 * with its customer, term, status, entitlements and commercial terms.
 *
 * Every write here is a verb with the operator recorded on it: issue, register
 * an existing license, revoke, reissue, reset the instance binding, edit the
 * terms, link to a customer. A signed license is shown exactly once, when it is
 * issued or reissued, and never read back.
 */
export default function LicensesView() {
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 300);
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<License | null>(null);

  const list = api.licenseRegistry.getAll.useQuery({
    page,
    pageSize: PAGE_SIZE,
    search: debouncedSearch || undefined,
  });
  const commands = useLicenseCommands();

  const licenses = list.data?.licenses ?? [];

  return (
    <>
      <BackofficeTable
        title="Licenses"
        searchValue={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(0);
        }}
        searchPlaceholder="Search by customer, email or license id"
        isLoading={list.isLoading}
        isFetching={list.isFetching}
        error={list.error}
        pagination={{
          page,
          perPage: PAGE_SIZE,
          total: list.data?.total ?? 0,
          onPageChange: setPage,
        }}
        onCreate={() => setCreating(true)}
        createLabel="New license"
      >
        <Table.Root variant="line" size="md">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>Customer</Table.ColumnHeader>
              <Table.ColumnHeader>Plan</Table.ColumnHeader>
              <Table.ColumnHeader>Seats</Table.ColumnHeader>
              <Table.ColumnHeader>Term ends</Table.ColumnHeader>
              <Table.ColumnHeader>Status</Table.ColumnHeader>
              <Table.ColumnHeader>Hosted services</Table.ColumnHeader>
              <Table.ColumnHeader>Instance</Table.ColumnHeader>
              <Table.ColumnHeader width="1%" />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {licenses.length === 0 && !list.isLoading ? (
              <Table.Row>
                <Table.Cell colSpan={COLUMN_COUNT}>
                  <Text color="fg.muted" fontSize="sm">
                    No licenses in the registry yet.
                  </Text>
                </Table.Cell>
              </Table.Row>
            ) : null}
            {licenses.map((license) => (
              <Table.Row
                key={license.id}
                cursor="pointer"
                onClick={() => setOpenId(license.id)}
              >
                <Table.Cell>
                  <VStack align="start" gap={0}>
                    <Text fontWeight="medium">{license.organizationName}</Text>
                    <Text fontSize="xs" color="fg.muted">
                      {license.organizationId
                        ? license.email
                        : "Not linked to a customer organization"}
                    </Text>
                  </VStack>
                </Table.Cell>
                <Table.Cell>{license.planType}</Table.Cell>
                <Table.Cell>
                  {license.maxMembers}
                  <Text as="span" fontSize="xs" color="fg.muted">
                    {" "}
                    +{license.effectiveSeatOverageAllowance} allowance
                  </Text>
                </Table.Cell>
                <Table.Cell>{formatDate(license.expiresAt)}</Table.Cell>
                <Table.Cell>
                  <StatusBadge status={license.status} />
                </Table.Cell>
                <Table.Cell>
                  {license.services.length === 0 ? (
                    <EmptyCell>none</EmptyCell>
                  ) : (
                    license.services
                      .map((service) =>
                        service in SERVICE_LABELS
                          ? SERVICE_LABELS[service as Service]
                          : service,
                      )
                      .join(", ")
                  )}
                </Table.Cell>
                <Table.Cell>
                  {license.instanceId ? (
                    <Badge colorPalette="green">bound</Badge>
                  ) : (
                    <EmptyCell>not bound</EmptyCell>
                  )}
                </Table.Cell>
                <Table.Cell>
                  <RowActions
                    license={license}
                    onOpen={() => setOpenId(license.id)}
                    onRevoke={() => setRevoking(license)}
                    onResetBinding={() =>
                      commands.resetInstanceBinding.mutate({ id: license.id })
                    }
                  />
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </BackofficeTable>

      <LicenseDrawer
        licenseId={openId}
        onClose={() => setOpenId(null)}
        onRevoke={(license) => setRevoking(license)}
      />
      <IssueDrawer open={creating} onClose={() => setCreating(false)} />
      <RevokeDialog license={revoking} onClose={() => setRevoking(null)} />
    </>
  );
}

function StatusBadge({ status }: { status: License["status"] }) {
  const palette = {
    active: "green",
    revoked: "red",
    superseded: "gray",
    expired: "orange",
  }[status];
  return <Badge colorPalette={palette}>{status}</Badge>;
}

function RowActions({
  license,
  onOpen,
  onRevoke,
  onResetBinding,
}: {
  license: License;
  onOpen: () => void;
  onRevoke: () => void;
  onResetBinding: () => void;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button
          size="xs"
          variant="ghost"
          aria-label={`Actions for ${license.organizationName}`}
          onClick={(event) => event.stopPropagation()}
        >
          <MoreVertical size={14} />
        </Button>
      </Menu.Trigger>
      <Menu.Content>
        <Menu.Item
          value="open"
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
        >
          Open
        </Menu.Item>
        {license.instanceId ? (
          <Menu.Item
            value="reset-binding"
            onClick={(event) => {
              event.stopPropagation();
              onResetBinding();
            }}
          >
            Reset instance binding
          </Menu.Item>
        ) : null}
        {license.status === "active" || license.status === "expired" ? (
          <Menu.Item
            value="revoke"
            color="fg.error"
            onClick={(event) => {
              event.stopPropagation();
              onRevoke();
            }}
          >
            Revoke
          </Menu.Item>
        ) : null}
      </Menu.Content>
    </Menu.Root>
  );
}

function useLicenseCommands() {
  const utils = api.useContext();
  const after = (title: string) => ({
    onSuccess: async () => {
      await utils.licenseRegistry.invalidate();
      toaster.create({ title, type: "success", duration: 3000 });
    },
    onError: (error: unknown) =>
      showErrorToast({ error, fallbackTitle: "The license was not changed" }),
  });
  return {
    revoke: api.licenseRegistry.revoke.useMutation(after("License revoked")),
    resetInstanceBinding: api.licenseRegistry.resetInstanceBinding.useMutation(
      after("Instance binding reset"),
    ),
    updateTerms: api.licenseRegistry.updateTerms.useMutation(
      after("Terms saved"),
    ),
    linkToOrganization: api.licenseRegistry.linkToOrganization.useMutation(
      after("License linked"),
    ),
  };
}

/** One issued or reissued license, shown once. */
function SignedLicenseOnce({ licenseKey }: { licenseKey: string }) {
  return (
    <VStack align="start" gap={2} width="full">
      <Text fontWeight="medium">Signed license</Text>
      <Text fontSize="sm" color="fg.muted">
        Copy it now and hand it to the customer. It is not stored and cannot be
        shown again.
      </Text>
      <Textarea
        readOnly
        rows={6}
        value={licenseKey}
        fontFamily="mono"
        fontSize="xs"
        onFocus={(event) => event.target.select()}
      />
    </VStack>
  );
}

function RevokeDialog({
  license,
  onClose,
}: {
  license: License | null;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const commands = useLicenseCommands();

  useEffect(() => {
    if (license) setReason("");
  }, [license]);

  return (
    <Dialog.Root
      open={license !== null}
      onOpenChange={({ open }) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Content onClick={(event) => event.stopPropagation()}>
        <Dialog.Header>
          <Dialog.Title>
            Revoke the license of {license?.organizationName}
          </Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <VStack align="start" gap={3}>
            <Text fontSize="sm">
              The install keeps working offline on the license it holds, but it
              can no longer reach LangWatch-hosted services or sync. This cannot
              be undone; issue a new license to restore access.
            </Text>
            <Field.Root required>
              <Field.Label>Reason</Field.Label>
              <Textarea
                rows={3}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Why this license is revoked, for the audit log"
              />
            </Field.Root>
          </VStack>
        </Dialog.Body>
        <Dialog.Footer>
          <HStack gap={3}>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              colorPalette="red"
              disabled={reason.trim().length < 3}
              loading={commands.revoke.isPending}
              onClick={() => {
                if (!license) return;
                commands.revoke.mutate(
                  { id: license.id, reason: reason.trim() },
                  { onSuccess: onClose },
                );
              }}
            >
              Revoke
            </Button>
          </HStack>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}

const dollarsToCents = (value: string): number | null => {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
};
const centsToDollars = (cents: number | null | undefined): string =>
  cents == null ? "" : (cents / 100).toFixed(2);

interface TermsForm {
  services: Service[];
  seatOverageAllowance: string;
  seatRate: string;
  seatCurrency: "USD" | "EUR";
  commit: string;
  overageEnabled: boolean;
  overageMax: string;
}

function termsFormFrom(license: License | null | undefined): TermsForm {
  return {
    services: (license?.services ?? []).filter((service): service is Service =>
      (SERVICES as readonly string[]).includes(service),
    ),
    seatOverageAllowance: license?.seatOverageAllowance?.toString() ?? "",
    seatRate: centsToDollars(license?.seatRateCents),
    seatCurrency: license?.seatCurrency ?? "USD",
    commit: centsToDollars(license?.commitUsdCents ?? 0),
    overageEnabled: license?.overageEnabled ?? false,
    overageMax: centsToDollars(license?.overageMaxUsdCents),
  };
}

function termsPayload(form: TermsForm) {
  return {
    services: form.services,
    seatOverageAllowance:
      form.seatOverageAllowance.trim() === ""
        ? null
        : Number(form.seatOverageAllowance),
    seatRateCents: dollarsToCents(form.seatRate),
    seatCurrency: form.seatRate.trim() === "" ? null : form.seatCurrency,
    commitUsdCents: dollarsToCents(form.commit) ?? 0,
    overageEnabled: form.overageEnabled,
    overageMaxUsdCents: form.overageEnabled
      ? dollarsToCents(form.overageMax)
      : null,
  };
}

function TermsFields({
  form,
  onChange,
}: {
  form: TermsForm;
  onChange: (form: TermsForm) => void;
}) {
  const set = <K extends keyof TermsForm>(key: K, value: TermsForm[K]) =>
    onChange({ ...form, [key]: value });
  return (
    <VStack align="start" gap={3} width="full">
      <Field.Root>
        <Field.Label>Hosted services included</Field.Label>
        <HStack gap={4}>
          {SERVICES.map((service) => (
            <label key={service} style={{ fontSize: "0.875rem" }}>
              <input
                type="checkbox"
                checked={form.services.includes(service)}
                onChange={(event) =>
                  set(
                    "services",
                    event.target.checked
                      ? [...form.services, service]
                      : form.services.filter((s) => s !== service),
                  )
                }
              />{" "}
              {SERVICE_LABELS[service]}
            </label>
          ))}
        </HStack>
        <Field.HelperText>
          Switching a service on does not reissue the license.
        </Field.HelperText>
      </Field.Root>
      <SimpleGrid columns={2} gap={3} width="full">
        <Field.Root>
          <Field.Label>Seat overage allowance</Field.Label>
          <Input
            type="number"
            min={0}
            value={form.seatOverageAllowance}
            onChange={(event) =>
              set("seatOverageAllowance", event.target.value)
            }
            placeholder="Default: a fifth of the seats, rounded up"
          />
        </Field.Root>
        <Field.Root>
          <Field.Label>Seat rate per year</Field.Label>
          <HStack>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={form.seatRate}
              onChange={(event) => set("seatRate", event.target.value)}
            />
            <NativeSelect.Root width="28">
              <NativeSelect.Field
                value={form.seatCurrency}
                onChange={(event) =>
                  set("seatCurrency", event.target.value as "USD" | "EUR")
                }
              >
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
          </HStack>
        </Field.Root>
        <Field.Root>
          <Field.Label>Prepaid usage commit (USD)</Field.Label>
          <Input
            type="number"
            min={0}
            step="0.01"
            value={form.commit}
            onChange={(event) => set("commit", event.target.value)}
          />
        </Field.Root>
        <Field.Root>
          <Field.Label>On-demand overage</Field.Label>
          <HStack>
            <NativeSelect.Root width="28">
              <NativeSelect.Field
                value={form.overageEnabled ? "on" : "off"}
                onChange={(event) =>
                  set("overageEnabled", event.target.value === "on")
                }
              >
                <option value="off">Off</option>
                <option value="on">On</option>
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
            <Input
              type="number"
              min={0}
              step="0.01"
              disabled={!form.overageEnabled}
              value={form.overageMax}
              onChange={(event) => set("overageMax", event.target.value)}
              placeholder="Maximum (USD)"
            />
          </HStack>
        </Field.Root>
      </SimpleGrid>
    </VStack>
  );
}

function LicenseDrawer({
  licenseId,
  onClose,
  onRevoke,
}: {
  licenseId: string | null;
  onClose: () => void;
  onRevoke: (license: License) => void;
}) {
  const query = api.licenseRegistry.getById.useQuery(
    { id: licenseId ?? "" },
    { enabled: licenseId !== null, retry: false },
  );
  const license = query.data;
  const commands = useLicenseCommands();
  const [terms, setTerms] = useState<TermsForm>(termsFormFrom(null));
  const [reissueSeats, setReissueSeats] = useState("");
  const [reissueExpires, setReissueExpires] = useState("");
  const [linkOrganizationId, setLinkOrganizationId] = useState("");
  const [issuedKey, setIssuedKey] = useState<string | null>(null);
  const utils = api.useContext();
  const reissue = api.licenseRegistry.reissue.useMutation({
    onSuccess: async (result) => {
      setIssuedKey(result.licenseKey);
      await utils.licenseRegistry.invalidate();
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "The license was not reissued" }),
  });

  useEffect(() => {
    setTerms(termsFormFrom(license));
    setReissueSeats(license?.maxMembers.toString() ?? "");
    setReissueExpires("");
    setIssuedKey(null);
  }, [license]);

  return (
    <Drawer.Root
      open={licenseId !== null}
      onOpenChange={({ open }) => {
        if (!open) onClose();
      }}
      size="lg"
    >
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>
            {license ? license.organizationName : "License"}
          </Drawer.Title>
        </Drawer.Header>
        <Drawer.CloseTrigger />
        <Drawer.Body>
          {!license ? (
            <Text color="fg.muted">Loading...</Text>
          ) : (
            <VStack align="start" gap={6} width="full">
              <SimpleGrid columns={2} gap={3} width="full" fontSize="sm">
                <Detail label="Status">
                  <StatusBadge status={license.status} />
                </Detail>
                <Detail label="License id">{license.licenseId}</Detail>
                <Detail label="Plan">{license.planType}</Detail>
                <Detail label="Seats">
                  {license.maxMembers} full, {license.maxMembersLite} lite,
                  allowance {license.effectiveSeatOverageAllowance}
                </Detail>
                <Detail label="Issued">{formatDate(license.issuedAt)}</Detail>
                <Detail label="Term ends">
                  {formatDate(license.expiresAt)}
                </Detail>
                <Detail label="Source">{license.source}</Detail>
                <Detail label="Email">{license.email}</Detail>
                <Detail label="Instance">
                  {license.instanceId
                    ? `${license.instanceId} since ${formatDateTime(license.instanceBoundAt)}`
                    : "not bound yet"}
                </Detail>
                <Detail label="Replaces">
                  {license.replacesId ?? <EmptyCell>none</EmptyCell>}
                </Detail>
                {license.revokedAt ? (
                  <Detail label="Revoked">
                    {formatDateTime(license.revokedAt)}: {license.revokedReason}
                  </Detail>
                ) : null}
                {license.hasPendingDelivery ? (
                  <Detail label="Delivery">
                    Reissued license waiting for the install to sync
                  </Detail>
                ) : null}
              </SimpleGrid>

              {!license.organizationId ? (
                <Section title="Link to a customer organization">
                  <Text fontSize="sm" color="fg.muted">
                    Until it is linked, this license resolves to no customer and
                    cannot use hosted services.
                  </Text>
                  <HStack width="full">
                    <Input
                      value={linkOrganizationId}
                      onChange={(event) =>
                        setLinkOrganizationId(event.target.value)
                      }
                      placeholder="Organization id"
                    />
                    <Button
                      size="sm"
                      disabled={linkOrganizationId.trim() === ""}
                      loading={commands.linkToOrganization.isPending}
                      onClick={() =>
                        commands.linkToOrganization.mutate({
                          id: license.id,
                          organizationId: linkOrganizationId.trim(),
                        })
                      }
                    >
                      Link
                    </Button>
                  </HStack>
                </Section>
              ) : null}

              <Section title="Entitlements and terms">
                <TermsFields form={terms} onChange={setTerms} />
                <Button
                  size="sm"
                  loading={commands.updateTerms.isPending}
                  onClick={() =>
                    commands.updateTerms.mutate({
                      id: license.id,
                      ...termsPayload(terms),
                    })
                  }
                >
                  Save terms
                </Button>
              </Section>

              {license.status === "active" || license.status === "expired" ? (
                <Section title="Reissue">
                  <Text fontSize="sm" color="fg.muted">
                    Signs a replacement with new seats or a new term. The
                    current license stays valid until the install picks the new
                    one up over sync.
                  </Text>
                  <SimpleGrid columns={2} gap={3} width="full">
                    <Field.Root>
                      <Field.Label>Seats</Field.Label>
                      <Input
                        type="number"
                        min={1}
                        value={reissueSeats}
                        onChange={(event) =>
                          setReissueSeats(event.target.value)
                        }
                      />
                    </Field.Root>
                    <Field.Root>
                      <Field.Label>New term end</Field.Label>
                      <Input
                        type="date"
                        value={reissueExpires}
                        onChange={(event) =>
                          setReissueExpires(event.target.value)
                        }
                      />
                    </Field.Root>
                  </SimpleGrid>
                  <Button
                    size="sm"
                    disabled={reissueExpires === "" || reissueSeats === ""}
                    loading={reissue.isPending}
                    onClick={() => {
                      const iso = dateInputToISO(reissueExpires);
                      if (!iso) return;
                      reissue.mutate({
                        id: license.id,
                        maxMembers: Number(reissueSeats),
                        expiresAt: new Date(iso),
                      });
                    }}
                  >
                    Reissue license
                  </Button>
                  {issuedKey ? (
                    <SignedLicenseOnce licenseKey={issuedKey} />
                  ) : null}
                </Section>
              ) : null}

              <HStack gap={3}>
                {license.instanceId ? (
                  <Button
                    size="sm"
                    variant="outline"
                    loading={commands.resetInstanceBinding.isPending}
                    onClick={() =>
                      commands.resetInstanceBinding.mutate({ id: license.id })
                    }
                  >
                    Reset instance binding
                  </Button>
                ) : null}
                {license.status === "active" || license.status === "expired" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    colorPalette="red"
                    onClick={() => onRevoke(license)}
                  >
                    Revoke
                  </Button>
                ) : null}
              </HStack>
            </VStack>
          )}
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}

function Detail({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <VStack align="start" gap={0}>
      <Text fontSize="xs" color="fg.muted">
        {label}
      </Text>
      <Text>{children}</Text>
    </VStack>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <VStack
      align="start"
      gap={3}
      width="full"
      borderTopWidth="1px"
      borderColor="border"
      paddingTop={4}
    >
      <Text fontWeight="semibold">{title}</Text>
      {children}
    </VStack>
  );
}

type IssueMode = "issue" | "register";

function IssueDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<IssueMode>("issue");
  const [customerMode, setCustomerMode] = useState<"existing" | "new">(
    "existing",
  );
  const [organizationId, setOrganizationId] = useState("");
  const [newOrganizationName, setNewOrganizationName] = useState("");
  const [email, setEmail] = useState("");
  const [planType, setPlanType] = useState<
    "GROWTH" | "PRO" | "ENTERPRISE" | "CUSTOM"
  >("ENTERPRISE");
  const [maxMembers, setMaxMembers] = useState("10");
  const [maxMembersLite, setMaxMembersLite] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [terms, setTerms] = useState<TermsForm>(termsFormFrom(null));
  const [licenseKey, setLicenseKey] = useState("");
  const [issuedKey, setIssuedKey] = useState<string | null>(null);
  const utils = api.useContext();

  useEffect(() => {
    if (open) setIssuedKey(null);
  }, [open]);

  const done = async (title: string) => {
    await utils.licenseRegistry.invalidate();
    toaster.create({ title, type: "success", duration: 3000 });
  };
  const issue = api.licenseRegistry.issue.useMutation({
    onSuccess: async (result) => {
      setIssuedKey(result.licenseKey);
      await done("License issued");
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "The license was not issued" }),
  });
  const register = api.licenseRegistry.registerLegacy.useMutation({
    onSuccess: async () => {
      await done("License registered");
      onClose();
    },
    onError: (error) =>
      showErrorToast({
        error,
        fallbackTitle: "The license was not registered",
      }),
  });

  const customer =
    customerMode === "existing"
      ? { organizationId: organizationId.trim() }
      : { newOrganizationName: newOrganizationName.trim() };
  const customerValid =
    customerMode === "existing"
      ? organizationId.trim() !== ""
      : newOrganizationName.trim() !== "";

  return (
    <Drawer.Root
      open={open}
      onOpenChange={({ open: next }) => {
        if (!next) onClose();
      }}
      size="lg"
    >
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>New license</Drawer.Title>
        </Drawer.Header>
        <Drawer.CloseTrigger />
        <Drawer.Body>
          <VStack align="start" gap={4} width="full">
            <Field.Root>
              <Field.Label>What to do</Field.Label>
              <NativeSelect.Root>
                <NativeSelect.Field
                  value={mode}
                  onChange={(event) => setMode(event.target.value as IssueMode)}
                >
                  <option value="issue">
                    Issue a new license, signed with the server key
                  </option>
                  <option value="register">
                    Register a license issued before the registry existed
                  </option>
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
            </Field.Root>

            <Field.Root>
              <Field.Label>Customer</Field.Label>
              <HStack width="full">
                <NativeSelect.Root width="44">
                  <NativeSelect.Field
                    value={customerMode}
                    onChange={(event) =>
                      setCustomerMode(event.target.value as "existing" | "new")
                    }
                  >
                    <option value="existing">Existing organization</option>
                    {mode === "issue" ? (
                      <option value="new">New organization</option>
                    ) : null}
                  </NativeSelect.Field>
                  <NativeSelect.Indicator />
                </NativeSelect.Root>
                {customerMode === "existing" ? (
                  <Input
                    value={organizationId}
                    onChange={(event) => setOrganizationId(event.target.value)}
                    placeholder="Organization id on LangWatch Cloud"
                  />
                ) : (
                  <Input
                    value={newOrganizationName}
                    onChange={(event) =>
                      setNewOrganizationName(event.target.value)
                    }
                    placeholder="Customer name, for example ACME"
                  />
                )}
              </HStack>
              <Field.HelperText>
                The organization hosted usage, budgets and invoices attach to.
              </Field.HelperText>
            </Field.Root>

            {mode === "register" ? (
              <Field.Root required>
                <Field.Label>License</Field.Label>
                <Textarea
                  rows={6}
                  value={licenseKey}
                  onChange={(event) => setLicenseKey(event.target.value)}
                  fontFamily="mono"
                  fontSize="xs"
                  placeholder="Paste the license the customer holds. Its signature is verified and only a hash of it is kept."
                />
              </Field.Root>
            ) : (
              <>
                <SimpleGrid columns={2} gap={3} width="full">
                  <Field.Root required>
                    <Field.Label>Contact email</Field.Label>
                    <Input
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                    />
                  </Field.Root>
                  <Field.Root>
                    <Field.Label>Plan</Field.Label>
                    <NativeSelect.Root>
                      <NativeSelect.Field
                        value={planType}
                        onChange={(event) =>
                          setPlanType(event.target.value as typeof planType)
                        }
                      >
                        {["ENTERPRISE", "GROWTH", "PRO", "CUSTOM"].map(
                          (plan) => (
                            <option key={plan} value={plan}>
                              {plan}
                            </option>
                          ),
                        )}
                      </NativeSelect.Field>
                      <NativeSelect.Indicator />
                    </NativeSelect.Root>
                  </Field.Root>
                  <Field.Root required>
                    <Field.Label>Full member seats</Field.Label>
                    <Input
                      type="number"
                      min={1}
                      value={maxMembers}
                      onChange={(event) => setMaxMembers(event.target.value)}
                    />
                  </Field.Root>
                  <Field.Root>
                    <Field.Label>Lite member seats</Field.Label>
                    <Input
                      type="number"
                      min={0}
                      value={maxMembersLite}
                      onChange={(event) =>
                        setMaxMembersLite(event.target.value)
                      }
                      placeholder="Plan default"
                    />
                  </Field.Root>
                  <Field.Root required>
                    <Field.Label>Term ends</Field.Label>
                    <Input
                      type="date"
                      value={expiresAt}
                      onChange={(event) => setExpiresAt(event.target.value)}
                    />
                  </Field.Root>
                </SimpleGrid>
                <TermsFields form={terms} onChange={setTerms} />
              </>
            )}

            {issuedKey ? <SignedLicenseOnce licenseKey={issuedKey} /> : null}
          </VStack>
        </Drawer.Body>
        <Drawer.Footer borderTopWidth="1px" borderColor="border">
          <HStack gap={3}>
            <Button variant="outline" onClick={onClose}>
              {issuedKey ? "Done" : "Cancel"}
            </Button>
            {issuedKey ? null : mode === "register" ? (
              <Button
                colorPalette="blue"
                disabled={
                  licenseKey.trim() === "" || organizationId.trim() === ""
                }
                loading={register.isPending}
                onClick={() =>
                  register.mutate({
                    licenseKey: licenseKey.trim(),
                    organizationId: organizationId.trim(),
                  })
                }
              >
                Register license
              </Button>
            ) : (
              <Button
                colorPalette="blue"
                disabled={
                  !customerValid ||
                  email.trim() === "" ||
                  expiresAt === "" ||
                  Number(maxMembers) < 1
                }
                loading={issue.isPending}
                onClick={() => {
                  const iso = dateInputToISO(expiresAt);
                  if (!iso) return;
                  issue.mutate({
                    customer,
                    email: email.trim(),
                    planType,
                    maxMembers: Number(maxMembers),
                    maxMembersLite:
                      maxMembersLite.trim() === ""
                        ? undefined
                        : Number(maxMembersLite),
                    expiresAt: new Date(iso),
                    terms: termsPayload(terms),
                  });
                }}
              >
                Issue license
              </Button>
            )}
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}
