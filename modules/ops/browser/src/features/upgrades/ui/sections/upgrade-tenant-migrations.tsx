import { Checkbox } from "@langwatch/design-system/checkbox";
import { CodePreview } from "@langwatch/design-system/code-preview";
import { FormattedDate } from "@langwatch/design-system/formatted-date";
import { FormattedNumber } from "@langwatch/design-system/formatted-number";
import { ListTable } from "@langwatch/design-system/list-table";
import {
  Badge,
  Box,
  Button,
  Center,
  Heading,
  HStack,
  Input,
  Spacer,
  Skeleton,
  Stack,
  Table,
  Text,
  Wrap,
} from "@langwatch/design-system/primitives";
import { SearchInput } from "@langwatch/design-system/search-input";
import { HandledErrorAlert } from "@langwatch/error-views";
import { Play, Undo2, UserPlus, Users } from "lucide-react";
import { useEffect, useState } from "react";

import { api, type RouterOutputs } from "../../../../behavior/ops-api.ts";
import { useOpsToaster, useShowErrorToast } from "../../../../behavior/ops-feedback.ts";
import { useOpsPermission } from "../../../../behavior/ops-session.ts";
import { ConfirmDialog } from "../../../../ui/elements/ops-confirm-dialog.tsx";
import { UpgradeTenantList } from "./upgrade-tenant-list.tsx";
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

/**
 * How a targeted run's outcome reads in the toast, per resulting status.
 */
const RUN_OUTCOME_LABEL: Record<string, string> = {
  finalized: "The organization finalized: it is fully on the new behavior.",
  migrated:
    "The organization is held: the work ran but the parity proof found disagreements to resolve. See its report below.",
  parked: "The organization parked on an error and will be retried. See its report below.",
  rolled_back: "The organization is pinned rolled back, so the run left it alone.",
};

/**
 * What a targeted run's toast says. `waiting` comes first because it overrides the status: a
 * waiting step records `migrated` exactly as a held one does, and reading it as held would tell
 * the operator a parity proof found disagreements when nothing ran at all.
 */
function runOutcomeToast({ status, waiting }: { status: string | null; waiting: boolean }): {
  title: string;
  description: string;
  type: "success" | "info";
} {
  if (waiting) {
    return {
      title: "Run finished: waiting",
      description:
        "This step is waiting on the earlier steps to finalize for this organization. Nothing ran and nothing changed - run the earlier steps first.",
      type: "info",
    };
  }
  return {
    title: `Run finished: ${STATUS_LABEL[status ?? ""] ?? "no state recorded"}`,
    description:
      (status ? RUN_OUTCOME_LABEL[status] : undefined) ??
      "The run recorded no state for this organization.",
    type: status === "finalized" ? "success" : "info",
  };
}

type MigrationListing = RouterOutputs["ops"]["upgrade"]["listSystemMigrations"][number];
type EnrollmentListing = RouterOutputs["ops"]["upgrade"]["listMigrationEnrollments"];
type EnrollmentRecord = EnrollmentListing["enrollments"][number];
type PickedOrganization = { id: string; name: string };

/** Tenant migrations: per-organization progress, enrolment and actions (was Ops > Migrations). */
export function UpgradeTenantMigrations() {
  const showErrorToast = useShowErrorToast();
  const toaster = useOpsToaster();
  const { scope } = useOpsPermission();
  const canManage = scope?.kind === "platform";

  const query = api.ops.upgrade.listSystemMigrations.useQuery(undefined, {});
  const enrollmentsQuery = api.ops.upgrade.listMigrationEnrollments.useQuery(undefined, {});
  const utils = api.useUtils();
  const runPass = api.ops.upgrade.runSystemMigrationPass.useMutation({
    onSuccess: async () => {
      toaster.create({
        title: "Migration pass started",
        description:
          "The pass runs in the background, several organizations at a time. This page refreshes as organizations move.",
        type: "success",
      });
      await utils.ops.upgrade.listSystemMigrations.invalidate();
    },
    onError: (error) => showErrorToast({ error, fallbackTitle: "Couldn't start the pass" }),
  });

  if (query.isLoading) {
    return (
      <Stack gap={4} aria-label="Loading tenant migrations">
        <Skeleton height="64px" />
        <Skeleton height="200px" />
      </Stack>
    );
  }

  // Only when there is nothing to show. This view polls every 30s, and a
  // failed refetch keeps the last good data - replacing a loaded table with
  // an error panel because one poll blipped loses the operator's place.
  if (query.error && !query.data) {
    return (
      <Center paddingY={20}>
        <HandledErrorAlert error={query.error} fallbackTitle="Couldn't load system migrations" />
      </Center>
    );
  }

  const isSaaS = enrollmentsQuery.data?.isSaaS ?? false;
  const enrollments = enrollmentsQuery.data?.enrollments ?? [];
  const migrations = query.data ?? [];

  return (
    <Stack gap={6}>
      <HStack alignItems="flex-start" gap={3} wrap="wrap">
        <Stack gap={1} flex={1} minWidth={0}>
          <Text textStyle="sm" color="fg.muted">
            Per-organization data migrations, run in order at worker boot. Held organizations failed
            the parity proof and stay on the legacy path; parked ones hit an error and retry.
          </Text>
          {enrollmentsQuery.data && !isSaaS && (
            <Text textStyle="sm" color="fg.muted">
              Released migrations run for every organization here, so nothing needs enrolling.
            </Text>
          )}
          {enrollmentsQuery.error && !enrollmentsQuery.data && (
            <Text textStyle="sm" color="fg.muted">
              Enrollment could not be read, so its actions are hidden. Retrying every 30 seconds.
            </Text>
          )}
        </Stack>
        <Button
          size="sm"
          disabled={!canManage}
          loading={runPass.isPending}
          onClick={() => runPass.mutate({})}
        >
          <Play size={14} /> Run a pass now
        </Button>
      </HStack>

      <ListTable
        density="compact"
        columnRules={false}
        containerProps={{ overflowX: "auto" }}
        data-testid="upgrade-tenant-migrations-table"
      >
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>Step</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">Finalized</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">Held</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">Parked</Table.ColumnHeader>
            {isSaaS && <Table.ColumnHeader textAlign="end">Enrolled</Table.ColumnHeader>}
            {canManage && <Table.ColumnHeader>Actions</Table.ColumnHeader>}
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {migrations.map((migration, index) => (
            <MigrationRow
              key={migration.name}
              migration={migration}
              previousMigrationTitle={migrations[index - 1]?.title}
              isSaaS={isSaaS}
              canManage={canManage}
            />
          ))}
        </Table.Body>
      </ListTable>

      {migrations.map((migration) => (
        <MigrationDetail
          key={migration.name}
          migration={migration}
          enrollments={enrollments.filter(
            (enrollment) => enrollment.migrationName === migration.name,
          )}
          isSaaS={isSaaS}
          canManage={canManage}
        />
      ))}

      <UpgradeTenantList steps={migrations} />
    </Stack>
  );
}

/** A zero is a quiet number; a non-zero count takes its palette as a badge. */
function CountCell({ count, palette }: { count: number; palette?: string }) {
  if (count === 0 || !palette) {
    return (
      <Text as="span" textStyle="sm" color={count === 0 ? "fg.subtle" : void 0}>
        <FormattedNumber value={count} />
      </Text>
    );
  }
  return (
    <Badge size="sm" variant="subtle" colorPalette={palette}>
      <FormattedNumber value={count} />
    </Badge>
  );
}

function MigrationRow({
  migration,
  previousMigrationTitle,
  isSaaS,
  canManage,
}: {
  migration: MigrationListing;
  previousMigrationTitle?: string;
  isSaaS: boolean;
  canManage: boolean;
}) {
  const requiresConfirmation = migration.requiresOperatorConfirmation;
  const actionable = canManage && migration.availableOnThisInstallation;
  return (
    <Table.Row data-testid={`upgrade-tenant-migration-${migration.name}`}>
      <Table.Cell maxWidth="420px">
        <Stack gap={0}>
          <Text textStyle="sm" truncate title={migration.title}>
            {migration.title}
          </Text>
          <Text textStyle="xs" color="fg.muted" fontFamily="mono" truncate title={migration.name}>
            {migration.name}
          </Text>
          {!migration.availableOnThisInstallation && (
            <Text textStyle="xs" color="fg.muted">
              Not yet available for self-hosted installations.
            </Text>
          )}
        </Stack>
      </Table.Cell>
      <Table.Cell textAlign="end">
        <CountCell count={migration.counts.finalized} />
      </Table.Cell>
      <Table.Cell textAlign="end">
        <CountCell count={migration.counts.migrated} palette="orange" />
      </Table.Cell>
      <Table.Cell textAlign="end">
        <CountCell count={migration.counts.parked} palette="red" />
      </Table.Cell>
      {isSaaS && (
        <Table.Cell textAlign="end">
          {migration.enrollment ? (
            <CountCell count={migration.enrollment.enrolledCount} />
          ) : (
            <Text as="span" textStyle="sm" color="fg.muted">
              All
            </Text>
          )}
        </Table.Cell>
      )}
      {canManage && (
        <Table.Cell>
          {actionable && (
            <Wrap gap={1}>
              {isSaaS && !migration.enrolledAutomatically && (
                <>
                  <EnrollAction
                    migrationName={migration.name}
                    migrationTitle={migration.title}
                    requiresConfirmation={requiresConfirmation}
                  />
                  <EnrollCohortAction
                    migrationName={migration.name}
                    migrationTitle={migration.title}
                    previousMigrationTitle={previousMigrationTitle}
                    requiresConfirmation={requiresConfirmation}
                  />
                </>
              )}
              <RunForOrganizationAction
                migrationName={migration.name}
                migrationTitle={migration.title}
                requiresConfirmation={requiresConfirmation}
              />
              <RollBackAction migrationName={migration.name} migrationTitle={migration.title} />
            </Wrap>
          )}
        </Table.Cell>
      )}
    </Table.Row>
  );
}

/** Enrolments and organizations needing attention for one step; nothing renders when quiet. */
function MigrationDetail({
  migration,
  enrollments,
  isSaaS,
  canManage,
}: {
  migration: MigrationListing;
  enrollments: EnrollmentRecord[];
  isSaaS: boolean;
  canManage: boolean;
}) {
  // An automatic step admits every organization, so its enrolment rows decide nothing.
  const showEnrollments =
    isSaaS && migration.availableOnThisInstallation && !migration.enrolledAutomatically;
  if (!migration.availableOnThisInstallation) return null;
  if (!showEnrollments && migration.attention.length === 0) return null;
  return (
    <Stack gap={3}>
      <Heading size="sm" truncate title={migration.title}>
        {migration.title}
      </Heading>
      {showEnrollments && <EnrollmentTable enrollments={enrollments} canManage={canManage} />}
      {migration.attention.length > 0 && (
        <ListTable density="compact" columnRules={false} containerProps={{ overflowX: "auto" }}>
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>Organization needing attention</Table.ColumnHeader>
              <Table.ColumnHeader>Status</Table.ColumnHeader>
              <Table.ColumnHeader>Last movement</Table.ColumnHeader>
              <Table.ColumnHeader>Report</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {migration.attention.map((record) => (
              <AttentionRow key={`${record.migrationName}:${record.tenantId}`} record={record} />
            ))}
          </Table.Body>
        </ListTable>
      )}
    </Stack>
  );
}

/**
 * The organization lookup every action dialog shares: search by name (or paste an exact id -
 * the search matches that too), pick from the results. Selection is the only way to proceed, so
 * an action can never fire against a typo.
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

  const search = api.ops.upgrade.searchMigrationOrganizations.useQuery(
    { query: debouncedQuery },
    { enabled: debouncedQuery.trim().length >= 2 },
  );

  if (value) {
    return (
      <HStack marginTop={3}>
        <Box>
          <Text textStyle="sm">{value.name}</Text>
          <Text fontFamily="mono" textStyle="xs" color="fg.muted">
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
      <SearchInput
        type="text"
        size="sm"
        aria-label="Search organizations"
        placeholder="Search organizations by name or paste an id"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {search.isFetching && (
        <Text textStyle="xs" color="fg.muted">
          Searching…
        </Text>
      )}
      {search.data?.length === 0 && !search.isFetching && (
        <Text textStyle="xs" color="fg.muted">
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
          <Text as="span" fontFamily="mono" textStyle="xs" color="fg.muted">
            {organization.id}
          </Text>
        </Button>
      ))}
    </Stack>
  );
}

/**
 * Enroll one organization for THIS migration. The preparation migrations enroll on a plain
 * confirm; the cutover is what lets the next pass change which tables answer the organization's
 * permission checks, so its dialog says so and the mutation carries the typed confirmation.
 */
function EnrollAction({
  migrationName,
  migrationTitle,
  requiresConfirmation,
}: {
  migrationName: string;
  migrationTitle: string;
  requiresConfirmation: boolean;
}) {
  const showErrorToast = useShowErrorToast();
  const toaster = useOpsToaster();
  const [open, setOpen] = useState(false);
  const [organization, setOrganization] = useState<PickedOrganization | null>(null);
  const utils = api.useUtils();
  const enroll = api.ops.upgrade.enrollMigrationTenant.useMutation({
    onSuccess: async () => {
      toaster.create({
        title: "Organization enrolled",
        description: "The next migration pass picks the enrollment up automatically.",
        type: "success",
      });
      setOpen(false);
      setOrganization(null);
      await Promise.all([
        utils.ops.upgrade.listMigrationEnrollments.invalidate(),
        utils.ops.upgrade.listSystemMigrations.invalidate(),
      ]);
    },
    onError: (error) => showErrorToast({ error, fallbackTitle: "Couldn't enroll" }),
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
            ...(requiresConfirmation ? { confirm: "ENROLL" as const } : {}),
          });
        }}
        title={`Enroll an organization for the ${migrationTitle.toLowerCase()}`}
        description={
          requiresConfirmation
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

/** Who the cohort draws from and who it leaves out, as one sentence pair. */
function describeScope({
  included,
  heldBack,
  sentence,
}: {
  included: string[];
  heldBack: string[];
  sentence: (phrases: string[], verb: string) => string;
}): string {
  if (included.length === 0) return sentence(heldBack, "are left out.");
  if (heldBack.length === 0) return sentence(included, "can be drawn.");
  return `${sentence(included, "can be drawn;")} ${sentence(heldBack, "are left out.").toLowerCase()}`;
}

/**
 * Enroll a sampled cohort for THIS migration in one action. The first step's sample is drawn
 * from organizations not yet enrolled; a later step's from the step before it.
 */
function cohortDialogDescription({
  previousMigrationTitle,
  requiresConfirmation,
  includeEnterprise,
  includePrivateDataplane,
}: {
  previousMigrationTitle?: string;
  requiresConfirmation: boolean;
  includeEnterprise: boolean;
  includePrivateDataplane: boolean;
}): string {
  const pool = previousMigrationTitle
    ? `Enrolls a random sample of organizations enrolled for the ${previousMigrationTitle.toLowerCase()} but not yet for this step. `
    : "Enrolls a random sample of organizations not yet enrolled for this step. ";
  const consequence = requiresConfirmation
    ? "Once their earlier steps finish, the next pass proves parity and moves every enrolled organization's permission checks onto the new engine. "
    : "It changes nothing about who answers permission checks. ";
  const included = [
    includeEnterprise ? "on an enterprise plan" : undefined,
    includePrivateDataplane ? "with a dedicated data plane" : undefined,
  ].filter((phrase) => phrase !== undefined);
  const heldBack = [
    includeEnterprise ? undefined : "on an enterprise plan",
    includePrivateDataplane ? undefined : "with a dedicated data plane",
  ].filter((phrase) => phrase !== undefined);
  const sentence = (phrases: string[], verb: string) =>
    `Organizations ${phrases.join(" or ")} ${verb}`;
  const scope = describeScope({ included, heldBack, sentence });
  return pool + consequence + scope;
}

/**
 * The two classes a cohort leaves out by default, each on its own switch.
 */
function HeldBackClassFields({
  includeEnterprise,
  onIncludeEnterpriseChange,
  includePrivateDataplane,
  onIncludePrivateDataplaneChange,
}: {
  includeEnterprise: boolean;
  onIncludeEnterpriseChange: (next: boolean) => void;
  includePrivateDataplane: boolean;
  onIncludePrivateDataplaneChange: (next: boolean) => void;
}) {
  return (
    <Stack gap={2} paddingTop={3}>
      <Text textStyle="sm">Organizations normally held back</Text>
      <Checkbox
        size="sm"
        checked={includeEnterprise}
        onCheckedChange={() => onIncludeEnterpriseChange(!includeEnterprise)}
      >
        Include organizations on an enterprise plan
      </Checkbox>
      <Checkbox
        size="sm"
        checked={includePrivateDataplane}
        onCheckedChange={() => onIncludePrivateDataplaneChange(!includePrivateDataplane)}
      >
        Include organizations with a dedicated data plane
      </Checkbox>
    </Stack>
  );
}

function EnrollCohortAction({
  migrationName,
  migrationTitle,
  previousMigrationTitle,
  requiresConfirmation,
}: {
  migrationName: string;
  migrationTitle: string;
  /** The step before this one; a later step's cohort samples from it. */
  previousMigrationTitle?: string;
  requiresConfirmation: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size="xs" variant="outline" onClick={() => setOpen(true)}>
        <Users size={13} /> Enroll cohort…
      </Button>
      {/* Mounted only while open, so the draft — the sample size and both
       *  lifted exclusions — starts fresh on every open. Lifting an
       *  exclusion is a decision about ONE cohort, and a checkbox that
       *  remembered its last state would silently widen the next draw. */}
      {open && (
        <CohortDialog
          migrationName={migrationName}
          migrationTitle={migrationTitle}
          previousMigrationTitle={previousMigrationTitle}
          requiresConfirmation={requiresConfirmation}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/** The mutation behind the cohort dialog, with the surfaces it refreshes. */
function useEnrollCohort({
  sampleSize,
  onEnrolled,
}: {
  sampleSize: number;
  onEnrolled: () => void;
}) {
  const showErrorToast = useShowErrorToast();
  const toaster = useOpsToaster();
  const utils = api.useUtils();
  return api.ops.upgrade.enrollMigrationCohort.useMutation({
    onSuccess: async (result) => {
      toaster.create(
        result.enrolled.length === 0
          ? {
              title: "No organizations enrolled",
              description: "No eligible organizations remained to enroll for this step.",
              type: "info",
            }
          : {
              title:
                result.enrolled.length === 1
                  ? "1 organization enrolled"
                  : `${result.enrolled.length} organizations enrolled`,
              description:
                result.enrolled.length < sampleSize
                  ? "Fewer eligible organizations remained than the requested cohort size, so every remaining one was enrolled. The next migration pass picks them up automatically."
                  : "The next migration pass picks the cohort up automatically.",
              type: "success",
            },
      );
      onEnrolled();
      await Promise.all([
        utils.ops.upgrade.listMigrationEnrollments.invalidate(),
        utils.ops.upgrade.listSystemMigrations.invalidate(),
      ]);
    },
    onError: (error) => showErrorToast({ error, fallbackTitle: "Couldn't enroll the cohort" }),
  });
}

function CohortDialog({
  migrationName,
  migrationTitle,
  previousMigrationTitle,
  requiresConfirmation,
  onClose,
}: {
  migrationName: string;
  migrationTitle: string;
  previousMigrationTitle?: string;
  requiresConfirmation: boolean;
  onClose: () => void;
}) {
  const [sampleSizeText, setSampleSizeText] = useState("50");
  const [includeEnterprise, setIncludeEnterprise] = useState(false);
  const [includePrivateDataplane, setIncludePrivateDataplane] = useState(false);
  // Number, not parseInt: "1e3" and "50.5" must disable Confirm rather than
  // be silently reinterpreted as 1 and 50.
  const sampleSize = Number(sampleSizeText);
  const sampleSizeValid = Number.isInteger(sampleSize) && sampleSize >= 1 && sampleSize <= 1000;
  const enrollCohort = useEnrollCohort({ sampleSize, onEnrolled: onClose });

  return (
    <ConfirmDialog
      open
      onClose={onClose}
      onConfirm={() => {
        if (!sampleSizeValid) return;
        enrollCohort.mutate({
          migrationName,
          sampleSize,
          includeEnterprise,
          includePrivateDataplane,
          ...(requiresConfirmation ? { confirm: "ENROLL" as const } : {}),
        });
      }}
      title={`Enroll a cohort for the ${migrationTitle.toLowerCase()}`}
      description={cohortDialogDescription({
        previousMigrationTitle,
        requiresConfirmation,
        includeEnterprise,
        includePrivateDataplane,
      })}
      isLoading={enrollCohort.isPending}
      confirmDisabled={!sampleSizeValid}
    >
      <Stack gap={1}>
        <Text textStyle="sm">How many organizations to enroll</Text>
        <Input
          size="sm"
          type="number"
          min={1}
          max={1000}
          step={1}
          value={sampleSizeText}
          onChange={(event) => setSampleSizeText(event.target.value)}
        />
        <HeldBackClassFields
          includeEnterprise={includeEnterprise}
          onIncludeEnterpriseChange={setIncludeEnterprise}
          includePrivateDataplane={includePrivateDataplane}
          onIncludePrivateDataplaneChange={setIncludePrivateDataplane}
        />
      </Stack>
    </ConfirmDialog>
  );
}

/**
 * Run THIS migration for one organization, now, without waiting for the next boot's pass. The
 * result toast reports the status the organization ended the run in - the operator asked about
 * one organization and gets its answer, not a fleet summary.
 */
function RunForOrganizationAction({
  migrationName,
  migrationTitle,
  requiresConfirmation,
}: {
  migrationName: string;
  migrationTitle: string;
  requiresConfirmation: boolean;
}) {
  const showErrorToast = useShowErrorToast();
  const toaster = useOpsToaster();
  const [open, setOpen] = useState(false);
  const [organization, setOrganization] = useState<PickedOrganization | null>(null);
  const utils = api.useUtils();
  const run = api.ops.upgrade.runSystemMigrationForOrganization.useMutation({
    onSuccess: async ({ status, waiting }) => {
      toaster.create(runOutcomeToast({ status, waiting }));
      setOpen(false);
      setOrganization(null);
      await utils.ops.upgrade.listSystemMigrations.invalidate();
    },
    onError: (error) => showErrorToast({ error, fallbackTitle: "Couldn't run the migration" }),
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
            ...(requiresConfirmation ? { confirm: "RUN" as const } : {}),
          });
        }}
        title={`Run the ${migrationTitle.toLowerCase()} for one organization`}
        description={
          requiresConfirmation
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
 * The state machine's one human-driven edge: finalized → rolled_back. The operator names the
 * organization through the same picker as every other action - finalized organizations are a
 * count rather than a listing, so they arrive here knowing which organization needs to go back.
 */
function RollBackAction({
  migrationName,
  migrationTitle,
}: {
  migrationName: string;
  migrationTitle: string;
}) {
  const showErrorToast = useShowErrorToast();
  const toaster = useOpsToaster();
  const [open, setOpen] = useState(false);
  const [organization, setOrganization] = useState<PickedOrganization | null>(null);
  const utils = api.useUtils();
  const rollBack = api.ops.upgrade.rollBackSystemMigrationTenant.useMutation({
    onSuccess: async () => {
      toaster.create({
        title: "Organization rolled back",
        description:
          "It is pinned to its legacy path again. Permission checks pick the change up within a minute, and later passes leave it alone.",
        type: "success",
      });
      setOpen(false);
      setOrganization(null);
      await utils.ops.upgrade.listSystemMigrations.invalidate();
    },
    onError: (error) => showErrorToast({ error, fallbackTitle: "Couldn't roll back" }),
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
        description="The organization returns to the behavior it had before this step finalized, and every later pass leaves it alone, until an operator intervenes again. Any organization can be rolled back, including one that keeps erroring and one this step has not reached yet."
        isLoading={rollBack.isPending}
        confirmDisabled={organization === null}
      >
        <OrganizationPicker value={organization} onChange={setOrganization} />
      </ConfirmDialog>
    </>
  );
}

/** Enrolled-and-fine rows are fine, so past a handful they fold away behind
 *  a count - a cohort of hundreds must not turn the page into a scroll. */
const ENROLLMENT_PREVIEW_ROWS = 8;

function EnrollmentTable({
  enrollments,
  canManage,
}: {
  enrollments: EnrollmentRecord[];
  canManage: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  if (enrollments.length === 0) {
    return (
      <Text textStyle="sm" color="fg.muted">
        No organizations are enrolled for this step yet.
      </Text>
    );
  }
  const visible = showAll ? enrollments : enrollments.slice(0, ENROLLMENT_PREVIEW_ROWS);
  const hiddenCount = enrollments.length - visible.length;
  return (
    <Stack gap={2}>
      <ListTable density="compact" columnRules={false} containerProps={{ overflowX: "auto" }}>
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>Enrolled organization</Table.ColumnHeader>
            <Table.ColumnHeader>Enrolled by</Table.ColumnHeader>
            <Table.ColumnHeader>Enrolled at</Table.ColumnHeader>
            {canManage && <Table.ColumnHeader />}
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {visible.map((enrollment) => (
            <EnrollmentRow
              key={`${enrollment.organizationId}:${enrollment.migrationName}`}
              enrollment={enrollment}
              canManage={canManage}
            />
          ))}
        </Table.Body>
      </ListTable>
      {(hiddenCount > 0 || showAll) && enrollments.length > ENROLLMENT_PREVIEW_ROWS && (
        <Button
          size="xs"
          variant="ghost"
          alignSelf="flex-start"
          onClick={() => setShowAll((value) => !value)}
        >
          {showAll ? "Show fewer" : `Show all ${enrollments.length} enrolled organizations`}
        </Button>
      )}
    </Stack>
  );
}

function EnrollmentRow({
  enrollment,
  canManage,
}: {
  enrollment: EnrollmentRecord;
  canManage: boolean;
}) {
  const showErrorToast = useShowErrorToast();
  const toaster = useOpsToaster();
  const utils = api.useUtils();
  const withdraw = api.ops.upgrade.withdrawMigrationTenant.useMutation({
    onSuccess: async () => {
      toaster.create({
        title: "Enrollment withdrawn",
        description:
          "Later passes leave this organization alone for that step. Nothing already done is undone.",
        type: "success",
      });
      await Promise.all([
        utils.ops.upgrade.listMigrationEnrollments.invalidate(),
        utils.ops.upgrade.listSystemMigrations.invalidate(),
      ]);
    },
    onError: (error) => showErrorToast({ error, fallbackTitle: "Couldn't withdraw" }),
  });

  return (
    <Table.Row>
      <Table.Cell>
        {enrollment.organizationName ? (
          <Text>{enrollment.organizationName}</Text>
        ) : (
          <Text color="fg.muted">Deleted organization</Text>
        )}
        <Text fontFamily="mono" textStyle="xs" color="fg.muted">
          {enrollment.organizationId}
        </Text>
      </Table.Cell>
      <Table.Cell>
        {enrollment.enrolledByLabel ?? (
          <Text as="span" fontFamily="mono" textStyle="xs">
            {enrollment.enrolledByUserId}
          </Text>
        )}
      </Table.Cell>
      <Table.Cell>
        <FormattedDate value={enrollment.createdAt} />
      </Table.Cell>
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

function AttentionRow({ record }: { record: MigrationListing["attention"][number] }) {
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
        <Table.Cell>
          <FormattedDate value={record.updatedAt} />
        </Table.Cell>
        <Table.Cell>
          {record.report == null ? (
            <Text textStyle="sm" color="fg.muted">
              No report
            </Text>
          ) : (
            <Button size="xs" variant="outline" onClick={() => setExpanded((value) => !value)}>
              {expanded ? "Hide report" : "Show report"}
            </Button>
          )}
        </Table.Cell>
      </Table.Row>
      {expanded && record.report != null && (
        <Table.Row>
          <Table.Cell colSpan={4}>
            <CodePreview
              code={JSON.stringify(record.report, null, 2)}
              language="json"
              filename="Migration report"
              compact
              lineNumbers
              maxHeight="320px"
            />
          </Table.Cell>
        </Table.Row>
      )}
    </>
  );
}
