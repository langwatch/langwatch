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
import { Play, Undo2, UserPlus, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Checkbox } from "~/components/ui/checkbox";
import { ListTable } from "~/components/ui/ListTable";
import { toaster } from "~/components/ui/toaster";
import { HandledErrorAlert, showErrorToast } from "~/features/errors";
import { useOpsPermission } from "~/hooks/useOpsPermission";
import { api, type RouterOutputs } from "~/utils/api";
import { JsonViewer } from "@langwatch/ops-web";
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

/**
 * How a targeted run's outcome reads in the toast, per resulting status.
 * `migrated` here always means HELD - a step that merely waited reports
 * `migrated` too, and the server flags that separately (see the waiting
 * copy below), because telling an operator a parity proof found
 * disagreements when nothing ran sends them looking for a problem that does
 * not exist.
 */
const RUN_OUTCOME_LABEL: Record<string, string> = {
  finalized: "The organization finalized: it is fully on the new behavior.",
  migrated:
    "The organization is held: the work ran but the parity proof found disagreements to resolve. See its report below.",
  parked:
    "The organization parked on an error and will be retried. See its report below.",
  rolled_back: "The organization is pinned rolled back, so the run left it alone.",
};

/**
 * What a targeted run's toast says. `waiting` comes first because it
 * overrides the status: a waiting step records `migrated` exactly as a held
 * one does, and reading it as held would tell the operator a parity proof
 * found disagreements when nothing ran at all.
 */
function runOutcomeToast({
  status,
  waiting,
}: {
  status: string | null;
  waiting: boolean;
}): { title: string; description: string; type: "success" | "info" } {
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
  const enrollmentsQuery = api.ops.listMigrationEnrollments.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const utils = api.useUtils();
  const runPass = api.ops.runSystemMigrationPass.useMutation({
    onSuccess: async () => {
      toaster.create({
        title: "Migration pass started",
        description:
          "The pass runs in the background, several organizations at a time. This page refreshes as organizations move.",
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
            One-time data migrations the system performs on itself, organization by
            organization, at worker boot. They run as an ordered pipeline: each step
            starts only after the previous steps finalized for that organization. Held
            organizations finished the work but failed the parity proof - they stay on
            their legacy path, behaving exactly as before, until the disagreement in their
            report is resolved and a later pass re-verifies them. Parked organizations hit
            an error and are retried automatically.
          </Text>
          {enrollmentsQuery.data && !isSaaS && (
            <Text fontSize="sm" color="fg.muted">
              This installation runs released migrations automatically for every
              organization, so there is nothing to enroll.
            </Text>
          )}
          {enrollmentsQuery.error &&
            !enrollmentsQuery.data && (
              // The enrollment actions hide themselves when this read fails,
              // which is the safe direction but an unexplained one: without
              // this line a cloud operator sees a page that looks like a
              // self-hosted installation.
              <Text fontSize="sm" color="fg.muted">
                Enrollment could not be read just now, so the enrollment actions are
                hidden. The page retries every 30 seconds.
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
          previousMigrationTitle={query.data?.[index - 1]?.title}
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

/**
 * One status figure. A zero is fine and stays gray and quiet; a non-zero
 * count takes its palette, so the eye lands only on what moved.
 */
function CountBadge({
  label,
  count,
  palette,
}: {
  label: string;
  count: number;
  palette: string;
}) {
  return (
    <Badge
      colorPalette={count === 0 ? "gray" : palette}
      variant={count === 0 ? "subtle" : "solid"}
    >
      {label} {count}
    </Badge>
  );
}

/** Space proportional to trouble: a zero reads as one quiet gray chip,
 *  a non-zero Held or Parked is the loud one. */
function MigrationStatusBadges({ migration }: { migration: MigrationListing }) {
  return (
    <HStack marginBottom={4} flexWrap="wrap" gap={2}>
      <CountBadge label="Finalized" count={migration.counts.finalized} palette="green" />
      <CountBadge label="Held" count={migration.counts.migrated} palette="orange" />
      <CountBadge label="Parked" count={migration.counts.parked} palette="red" />
      {migration.counts.rolled_back > 0 && (
        <CountBadge
          label="Rolled back"
          count={migration.counts.rolled_back}
          palette="gray"
        />
      )}
      {migration.enrollment && (
        <>
          <CountBadge
            label="Enrolled"
            count={migration.enrollment.enrolledCount}
            palette="blue"
          />
          <Badge colorPalette="gray" variant="subtle">
            Not enrolled {migration.enrollment.notEnrolledCount}
          </Badge>
        </>
      )}
    </HStack>
  );
}

function MigrationSection({
  step,
  migration,
  previousMigrationTitle,
  enrollments,
  isSaaS,
  canManage,
}: {
  step: number;
  migration: MigrationListing;
  previousMigrationTitle?: string;
  enrollments: EnrollmentRecord[];
  isSaaS: boolean;
  canManage: boolean;
}) {
  // Which steps take a typed confirmation is the server's call, declared by
  // the migration itself - the page asks for it exactly where the server
  // requires it rather than recognising a step by its name.
  const requiresConfirmation = migration.requiresOperatorConfirmation;
  return (
    <Box borderWidth="1px" borderColor="border.emphasized" borderRadius="lg" padding={5}>
      <HStack marginBottom={1} flexWrap="wrap" gap={3}>
        <Heading size="md">
          Step {step} · {migration.title}
        </Heading>
        <Text fontFamily="mono" fontSize="xs" color="fg.muted">
          {migration.name}
        </Text>
        <Spacer />
        {canManage && migration.availableOnThisInstallation && (
          <HStack>
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
      <MigrationStatusBadges migration={migration} />
      {!migration.availableOnThisInstallation ? (
        <Text fontSize="sm" color="fg.muted">
          Not yet available for self-hosted installations. It will run automatically, for
          every organization, in a later release - nothing to do until then.
        </Text>
      ) : (
        <Stack gap={4}>
          {isSaaS && <EnrollmentTable enrollments={enrollments} canManage={canManage} />}
          {migration.attention.length === 0 ? (
            <Text fontSize="sm" color="fg.muted">
              No organizations need attention.
            </Text>
          ) : (
            <ListTable size="sm">
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
            </ListTable>
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
  requiresConfirmation,
}: {
  migrationName: string;
  migrationTitle: string;
  requiresConfirmation: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [organization, setOrganization] = useState<PickedOrganization | null>(null);
  const utils = api.useUtils();
  const enroll = api.ops.enrollMigrationTenant.useMutation({
    onSuccess: async () => {
      toaster.create({
        title: "Organization enrolled",
        description: "The next migration pass picks the enrollment up automatically.",
        type: "success",
      });
      setOpen(false);
      setOrganization(null);
      await Promise.all([
        utils.ops.listMigrationEnrollments.invalidate(),
        utils.ops.listSystemMigrations.invalidate(),
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

/**
 * Enroll a sampled cohort for THIS migration in one action. The first
 * step's sample is drawn from organizations not yet enrolled; a later
 * step's from the step before it. The platform leaves out the ones it
 * already knows to hold back, by data: an active enterprise
 * subscription, or a dedicated data plane configured in the environment.
 * No organization is ever named in code to exclude it.
 *
 * Both are defaults an operator can lift, one at a time, which is how a
 * proven rollout is finished without enrolling the held-back
 * organizations one id at a time. The description says which of them this
 * draw will include, because "left out" and "included" must never be a
 * guess about a checkbox the reader has already ticked.
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
  const scope =
    included.length === 0
      ? `${sentence(heldBack, "are left out.")}`
      : heldBack.length === 0
        ? `${sentence(included, "can be drawn.")}`
        : `${sentence(included, "can be drawn;")} ${sentence(
            heldBack,
            "are left out.",
          ).toLowerCase()}`;
  return pool + consequence + scope;
}

/**
 * What a finished cohort draw says. A short pool is not an error — the
 * action asked for a sample and got everything that was left — so it reads
 * as success with the shortfall explained, and an empty pool as information.
 */
function cohortResultToast({
  enrolledCount,
  sampleSize,
}: {
  enrolledCount: number;
  sampleSize: number;
}) {
  if (enrolledCount === 0) {
    return {
      title: "No organizations enrolled",
      description:
        "No eligible organizations remained to enroll for this step.",
      type: "info" as const,
    };
  }
  return {
    title:
      enrolledCount === 1
        ? "1 organization enrolled"
        : `${enrolledCount} organizations enrolled`,
    description:
      enrolledCount < sampleSize
        ? "Fewer eligible organizations remained than the requested cohort size, so every remaining one was enrolled. The next migration pass picks them up automatically."
        : "The next migration pass picks the cohort up automatically.",
    type: "success" as const,
  };
}

/**
 * The two classes a cohort leaves out by default, each on its own switch.
 * Separate because the risks are different in kind — an enterprise
 * organization is a commercial relationship, a dedicated-data-plane one
 * keeps its events in a ClickHouse instance of its own — and a single
 * "include everything" control would hide that from whoever ticks it.
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
      <Text fontSize="sm">Organizations normally held back</Text>
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
        onCheckedChange={() =>
          onIncludePrivateDataplaneChange(!includePrivateDataplane)
        }
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
  const utils = api.useUtils();
  return api.ops.enrollMigrationCohort.useMutation({
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
        utils.ops.listMigrationEnrollments.invalidate(),
        utils.ops.listSystemMigrations.invalidate(),
      ]);
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't enroll the cohort" }),
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
  const sampleSizeValid =
    Number.isInteger(sampleSize) && sampleSize >= 1 && sampleSize <= 1000;
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
        <Text fontSize="sm">How many organizations to enroll</Text>
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
 * Run THIS migration for one organization, now, without waiting for the
 * next boot's pass. The result toast reports the status the organization
 * ended the run in - the operator asked about one organization and gets its
 * answer, not a fleet summary.
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
  const [open, setOpen] = useState(false);
  const [organization, setOrganization] = useState<PickedOrganization | null>(null);
  const utils = api.useUtils();
  const run = api.ops.runSystemMigrationForOrganization.useMutation({
    onSuccess: async ({ status, waiting }) => {
      toaster.create(runOutcomeToast({ status, waiting }));
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
  const [organization, setOrganization] = useState<PickedOrganization | null>(null);
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
      <Text fontSize="sm" color="fg.muted">
        No organizations are enrolled for this step yet.
      </Text>
    );
  }
  const visible = showAll ? enrollments : enrollments.slice(0, ENROLLMENT_PREVIEW_ROWS);
  const hiddenCount = enrollments.length - visible.length;
  return (
    <Stack gap={2}>
      <ListTable size="sm">
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
          {showAll
            ? "Show fewer"
            : `Show all ${enrollments.length} enrolled organizations`}
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
