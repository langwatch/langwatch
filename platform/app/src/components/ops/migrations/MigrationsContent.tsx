import {
  Badge,
  Box,
  Button,
  Center,
  Heading,
  HStack,
  Input,
  Spacer,
  Spinner,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import { Play, Undo2, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { toaster } from "~/components/ui/toaster";
import { HandledErrorAlert, showErrorToast } from "~/features/errors";
import { useOpsPermission } from "~/hooks/useOpsPermission";
import { api, type RouterOutputs } from "~/utils/api";
import { JsonViewer } from "../JsonViewer";
import { ConfirmDialog } from "../shared/ConfirmDialog";

const STATUS_COLOR: Record<string, string> = {
  finalized: "green",
  migrated: "orange",
  parked: "red",
  rolled_back: "gray",
};

const STATUS_LABEL: Record<string, string> = {
  finalized: "Finalized",
  migrated: "Held",
  parked: "Parked",
  rolled_back: "Rolled back",
};

/** How a targeted run's outcome reads in the toast, per resulting status. */
const RUN_OUTCOME_LABEL: Record<string, string> = {
  finalized: "The organization finalized: it is fully on the new behavior.",
  migrated:
    "The organization is held: the work ran but the parity proof found disagreements to resolve. See its report below.",
  parked:
    "The organization parked on an error and will be retried. See its report below.",
  rolled_back:
    "The organization is pinned rolled back, so the run left it alone.",
};

type MigrationListing = RouterOutputs["ops"]["listSystemMigrations"][number];
type EnrollmentListing = RouterOutputs["ops"]["listMigrationEnrollments"];
type EnrollmentRecord = EnrollmentListing["enrollments"][number];
type PickedOrganization = { id: string; name: string };

export function MigrationsContent() {
  const { scope } = useOpsPermission();
  const canManage = scope?.kind === "platform";

  const query = api.ops.listSystemMigrations.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const enrollmentsQuery = api.ops.listMigrationEnrollments.useQuery(
    undefined,
    { refetchInterval: 30_000 },
  );
  const utils = api.useUtils();
  const runPass = api.ops.runSystemMigrationPass.useMutation({
    onSuccess: async () => {
      toaster.create({
        title: "Migration pass started",
        description:
          "The pass runs in the background under the fleet-wide lease. This page refreshes as organizations move.",
        type: "success",
      });
      await utils.ops.listSystemMigrations.invalidate();
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't start the pass" }),
  });

  if (query.isLoading) {
    return (
      <Center paddingY={20}>
        <Spinner />
      </Center>
    );
  }

  // Only when there is nothing to show. This view polls every 30s, and a
  // failed refetch keeps the last good data - replacing a loaded table with
  // an error panel because one poll blipped loses the operator's place.
  if (query.error && !query.data) {
    return (
      <Center paddingY={20}>
        <HandledErrorAlert
          error={query.error}
          fallbackTitle="Couldn't load system migrations"
        />
      </Center>
    );
  }

  const isSaaS = enrollmentsQuery.data?.isSaaS ?? false;
  const enrollments = enrollmentsQuery.data?.enrollments ?? [];

  return (
    <Stack gap={8} paddingY={4} maxWidth="1200px">
      <HStack alignItems="flex-start">
        <Stack gap={2} maxWidth="720px">
          <Text fontSize="sm" color="fg.muted">
            One-time data migrations the system performs on itself, organization
            by organization, at worker boot. They run as an ordered pipeline:
            each step starts only after the previous steps finalized for that
            organization. Held organizations finished the work but failed the
            parity proof - they stay on their legacy path, behaving exactly as
            before, until the disagreement in their report is resolved and a
            later pass re-verifies them. Parked organizations hit an error and
            are retried automatically.
          </Text>
          {enrollmentsQuery.data && !isSaaS && (
            <Text fontSize="sm" color="fg.muted">
              This installation runs released migrations automatically for every
              organization, so there is nothing to enroll.
            </Text>
          )}
        </Stack>
        <Spacer />
        <Button
          size="sm"
          disabled={!canManage}
          loading={runPass.isPending}
          onClick={() => runPass.mutate()}
        >
          <Play size={14} /> Run a pass now
        </Button>
      </HStack>

      {(query.data ?? []).map((migration, index) => (
        <MigrationSection
          key={migration.name}
          step={index + 1}
          migration={migration}
          enrollments={enrollments.filter(
            (enrollment) => enrollment.migrationName === migration.name,
          )}
          isSaaS={isSaaS}
          canManage={canManage}
        />
      ))}
    </Stack>
  );
}

function MigrationSection({
  step,
  migration,
  enrollments,
  isSaaS,
  canManage,
}: {
  step: number;
  migration: MigrationListing;
  enrollments: EnrollmentRecord[];
  isSaaS: boolean;
  canManage: boolean;
}) {
  const isCutover = migration.name === "authz-grants-cutover";
  return (
    <Box>
      <HStack marginBottom={1} flexWrap="wrap">
        <Heading size="md">
          Step {step} · {migration.title}
        </Heading>
        <Text fontFamily="mono" fontSize="xs" color="fg.muted">
          {migration.name}
        </Text>
        <Badge colorPalette="green">
          Finalized {migration.counts.finalized}
        </Badge>
        <Badge colorPalette="orange">Held {migration.counts.migrated}</Badge>
        <Badge colorPalette="red">Parked {migration.counts.parked}</Badge>
        {migration.counts.rolled_back > 0 && (
          <Badge colorPalette="gray">
            Rolled back {migration.counts.rolled_back}
          </Badge>
        )}
        {migration.enrollment && (
          <>
            <Badge colorPalette="blue">
              Enrolled {migration.enrollment.enrolledCount}
            </Badge>
            <Badge colorPalette="purple">
              Eligible {migration.enrollment.eligibleCount}
            </Badge>
          </>
        )}
        <Spacer />
        {canManage && migration.availableOnThisInstallation && (
          <HStack>
            {isSaaS && (
              <EnrollAction
                migrationName={migration.name}
                migrationTitle={migration.title}
                isCutover={isCutover}
              />
            )}
            <RunForOrganizationAction
              migrationName={migration.name}
              migrationTitle={migration.title}
              isCutover={isCutover}
            />
            <RollBackAction
              migrationName={migration.name}
              migrationTitle={migration.title}
            />
          </HStack>
        )}
      </HStack>
      <Text fontSize="sm" color="fg.muted" maxWidth="720px" marginBottom={3}>
        {migration.description}
      </Text>
      {!migration.availableOnThisInstallation ? (
        <Text fontSize="sm" color="fg.muted">
          Not yet available for self-hosted installations. It will run
          automatically, for every organization, in a later release - nothing to
          do until then.
        </Text>
      ) : (
        <Stack gap={4}>
          {isSaaS && (
            <EnrollmentTable enrollments={enrollments} canManage={canManage} />
          )}
          {migration.attention.length === 0 ? (
            <Text fontSize="sm" color="fg.muted">
              No organizations need attention.
            </Text>
          ) : (
            <Table.Root size="sm">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>Organization</Table.ColumnHeader>
                  <Table.ColumnHeader>Status</Table.ColumnHeader>
                  <Table.ColumnHeader>Last movement</Table.ColumnHeader>
                  <Table.ColumnHeader>Report</Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {migration.attention.map((record) => (
                  <AttentionRow
                    key={`${record.migrationName}:${record.tenantId}`}
                    record={record}
                  />
                ))}
              </Table.Body>
            </Table.Root>
          )}
        </Stack>
      )}
    </Box>
  );
}

/**
 * The organization lookup every action dialog shares: search by name (or
 * paste an exact id - the search matches that too), pick from the results.
 * Selection is the only way to proceed, so an action can never fire against
 * a typo.
 */
function OrganizationPicker({
  value,
  onChange,
}: {
  value: PickedOrganization | null;
  onChange: (organization: PickedOrganization | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const search = api.ops.searchMigrationOrganizations.useQuery(
    { query: debouncedQuery },
    { enabled: debouncedQuery.trim().length >= 2 },
  );

  if (value) {
    return (
      <HStack marginTop={3}>
        <Box>
          <Text fontSize="sm">{value.name}</Text>
          <Text fontFamily="mono" fontSize="xs" color="fg.muted">
            {value.id}
          </Text>
        </Box>
        <Spacer />
        <Button size="xs" variant="outline" onClick={() => onChange(null)}>
          Change
        </Button>
      </HStack>
    );
  }

  return (
    <Stack gap={2} marginTop={3}>
      <Input
        size="sm"
        aria-label="Search organizations"
        placeholder="Search organizations by name or paste an id"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {search.isFetching && (
        <Text fontSize="xs" color="fg.muted">
          Searching…
        </Text>
      )}
      {search.data?.length === 0 && !search.isFetching && (
        <Text fontSize="xs" color="fg.muted">
          No organizations match.
        </Text>
      )}
      {(search.data ?? []).map((organization) => (
        <Button
          key={organization.id}
          size="xs"
          variant="ghost"
          justifyContent="flex-start"
          onClick={() => onChange(organization)}
        >
          <Text as="span">{organization.name}</Text>
          <Text as="span" fontFamily="mono" fontSize="xs" color="fg.muted">
            {organization.id}
          </Text>
        </Button>
      ))}
    </Stack>
  );
}

/**
 * Enroll one organization for THIS migration. The preparation migrations
 * enroll on a plain confirm; the cutover is what lets the next pass change
 * which tables answer the organization's permission checks, so its dialog
 * says so and the mutation carries the typed confirmation.
 */
function EnrollAction({
  migrationName,
  migrationTitle,
  isCutover,
}: {
  migrationName: string;
  migrationTitle: string;
  isCutover: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [organization, setOrganization] = useState<PickedOrganization | null>(
    null,
  );
  const utils = api.useUtils();
  const enroll = api.ops.enrollMigrationTenant.useMutation({
    onSuccess: async () => {
      toaster.create({
        title: "Organization enrolled",
        description:
          "The next migration pass picks the enrollment up automatically.",
        type: "success",
      });
      setOpen(false);
      setOrganization(null);
      await Promise.all([
        utils.ops.listMigrationEnrollments.invalidate(),
        utils.ops.listSystemMigrations.invalidate(),
      ]);
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't enroll" }),
  });

  return (
    <>
      <Button size="xs" variant="outline" onClick={() => setOpen(true)}>
        <UserPlus size={13} /> Enroll…
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => {
          setOpen(false);
          setOrganization(null);
        }}
        onConfirm={() => {
          if (!organization) return;
          enroll.mutate({
            organizationId: organization.id,
            migrationName,
            ...(isCutover ? { confirm: "ENROLL" as const } : {}),
          });
        }}
        title={`Enroll an organization for the ${migrationTitle.toLowerCase()}`}
        description={
          isCutover
            ? "Once its earlier steps finish, the next pass proves parity and moves this organization's permission checks onto the new engine. Rolling that back afterwards is an operator action of its own."
            : "The next pass runs this step for the organization. It changes nothing about who answers permission checks, and withdrawing later stops future passes without undoing anything."
        }
        isLoading={enroll.isPending}
        confirmDisabled={organization === null}
      >
        <OrganizationPicker value={organization} onChange={setOrganization} />
      </ConfirmDialog>
    </>
  );
}

/**
 * Run THIS migration for one organization, now, without waiting for the
 * next boot's pass. The result toast reports the status the organization
 * ended the run in - the operator asked about one organization and gets its
 * answer, not a fleet summary.
 */
function RunForOrganizationAction({
  migrationName,
  migrationTitle,
  isCutover,
}: {
  migrationName: string;
  migrationTitle: string;
  isCutover: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [organization, setOrganization] = useState<PickedOrganization | null>(
    null,
  );
  const utils = api.useUtils();
  const run = api.ops.runSystemMigrationForOrganization.useMutation({
    onSuccess: async ({ status }) => {
      toaster.create({
        title: `Run finished: ${STATUS_LABEL[status ?? ""] ?? "no state recorded"}`,
        description:
          (status && RUN_OUTCOME_LABEL[status]) ??
          "The run recorded no state for this organization.",
        type: status === "finalized" ? "success" : "info",
      });
      setOpen(false);
      setOrganization(null);
      await utils.ops.listSystemMigrations.invalidate();
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't run the migration" }),
  });

  return (
    <>
      <Button size="xs" variant="outline" onClick={() => setOpen(true)}>
        <Play size={13} /> Run for organization…
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => {
          setOpen(false);
          setOrganization(null);
        }}
        onConfirm={() => {
          if (!organization) return;
          run.mutate({
            organizationId: organization.id,
            migrationName,
            ...(isCutover ? { confirm: "RUN" as const } : {}),
          });
        }}
        title={`Run the ${migrationTitle.toLowerCase()} for one organization`}
        description={
          isCutover
            ? "If parity proves clean, this moves the organization's permission checks onto the new engine right now. The organization must already be enrolled for this step."
            : "Runs this step for the organization right now and reports how it ended. The organization must already be enrolled for this step."
        }
        isLoading={run.isPending}
        confirmDisabled={organization === null}
      >
        <OrganizationPicker value={organization} onChange={setOrganization} />
      </ConfirmDialog>
    </>
  );
}

/**
 * The state machine's one human-driven edge: finalized → rolled_back. The
 * operator names the organization through the same picker as every other
 * action - finalized organizations are a count rather than a listing, so
 * they arrive here knowing which organization needs to go back.
 */
function RollBackAction({
  migrationName,
  migrationTitle,
}: {
  migrationName: string;
  migrationTitle: string;
}) {
  const [open, setOpen] = useState(false);
  const [organization, setOrganization] = useState<PickedOrganization | null>(
    null,
  );
  const utils = api.useUtils();
  const rollBack = api.ops.rollBackSystemMigrationTenant.useMutation({
    onSuccess: async () => {
      toaster.create({
        title: "Organization rolled back",
        description:
          "It is pinned to its legacy path again. Permission checks pick the change up within a minute, and later passes leave it alone.",
        type: "success",
      });
      setOpen(false);
      setOrganization(null);
      await utils.ops.listSystemMigrations.invalidate();
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't roll back" }),
  });

  return (
    <>
      <Button size="xs" variant="outline" onClick={() => setOpen(true)}>
        <Undo2 size={13} /> Roll back…
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => {
          setOpen(false);
          // Drop the picked organization with the dialog. Reopening for a
          // DIFFERENT organization must not arrive pre-filled with the last
          // one and the confirm button already live.
          setOrganization(null);
        }}
        onConfirm={() => {
          if (!organization) return;
          rollBack.mutate({
            migrationName,
            tenantId: organization.id,
            confirm: "ROLL BACK",
          });
        }}
        title={`Roll an organization back from the ${migrationTitle.toLowerCase()}`}
        description="The organization returns to the behavior it had before this step finalized, and stays there until an operator intervenes again. Only migrated or finalized organizations can be rolled back."
        isLoading={rollBack.isPending}
        confirmDisabled={organization === null}
      >
        <OrganizationPicker value={organization} onChange={setOrganization} />
      </ConfirmDialog>
    </>
  );
}

function EnrollmentTable({
  enrollments,
  canManage,
}: {
  enrollments: EnrollmentRecord[];
  canManage: boolean;
}) {
  if (enrollments.length === 0) {
    return (
      <Text fontSize="sm" color="fg.muted">
        No organizations are enrolled for this step yet.
      </Text>
    );
  }
  return (
    <Table.Root size="sm">
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>Enrolled organization</Table.ColumnHeader>
          <Table.ColumnHeader>Enrolled by</Table.ColumnHeader>
          <Table.ColumnHeader>Enrolled at</Table.ColumnHeader>
          {canManage && <Table.ColumnHeader />}
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {enrollments.map((enrollment) => (
          <EnrollmentRow
            key={`${enrollment.organizationId}:${enrollment.migrationName}`}
            enrollment={enrollment}
            canManage={canManage}
          />
        ))}
      </Table.Body>
    </Table.Root>
  );
}

function EnrollmentRow({
  enrollment,
  canManage,
}: {
  enrollment: EnrollmentRecord;
  canManage: boolean;
}) {
  const utils = api.useUtils();
  const withdraw = api.ops.withdrawMigrationTenant.useMutation({
    onSuccess: async () => {
      toaster.create({
        title: "Enrollment withdrawn",
        description:
          "Later passes leave this organization alone for that step. Nothing already done is undone.",
        type: "success",
      });
      await Promise.all([
        utils.ops.listMigrationEnrollments.invalidate(),
        utils.ops.listSystemMigrations.invalidate(),
      ]);
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't withdraw" }),
  });

  return (
    <Table.Row>
      <Table.Cell>
        {enrollment.organizationName ? (
          <Text>{enrollment.organizationName}</Text>
        ) : (
          <Text color="fg.muted">Deleted organization</Text>
        )}
        <Text fontFamily="mono" fontSize="xs" color="fg.muted">
          {enrollment.organizationId}
        </Text>
      </Table.Cell>
      <Table.Cell>
        {enrollment.enrolledByLabel ?? (
          <Text as="span" fontFamily="mono" fontSize="xs">
            {enrollment.enrolledByUserId}
          </Text>
        )}
      </Table.Cell>
      <Table.Cell>{new Date(enrollment.createdAt).toLocaleString()}</Table.Cell>
      {canManage && (
        <Table.Cell textAlign="right">
          <Button
            size="xs"
            variant="outline"
            loading={withdraw.isPending}
            onClick={() =>
              withdraw.mutate({
                organizationId: enrollment.organizationId,
                migrationName: enrollment.migrationName,
              })
            }
          >
            Withdraw
          </Button>
        </Table.Cell>
      )}
    </Table.Row>
  );
}

function AttentionRow({
  record,
}: {
  record: MigrationListing["attention"][number];
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <Table.Row>
        <Table.Cell fontFamily="mono">{record.tenantId}</Table.Cell>
        <Table.Cell>
          <Badge colorPalette={STATUS_COLOR[record.status] ?? "gray"}>
            {STATUS_LABEL[record.status] ?? record.status}
          </Badge>
        </Table.Cell>
        <Table.Cell>{new Date(record.updatedAt).toLocaleString()}</Table.Cell>
        <Table.Cell>
          {record.report == null ? (
            <Text fontSize="sm" color="fg.muted">
              No report
            </Text>
          ) : (
            <Button
              size="xs"
              variant="outline"
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? "Hide report" : "Show report"}
            </Button>
          )}
        </Table.Cell>
      </Table.Row>
      {expanded && record.report != null && (
        <Table.Row>
          <Table.Cell colSpan={4}>
            <JsonViewer data={record.report} maxHeight="320px" />
          </Table.Cell>
        </Table.Row>
      )}
    </>
  );
}
