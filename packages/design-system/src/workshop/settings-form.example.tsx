import { Banner } from "@langwatch/design-system/banner";
import { IdText } from "@langwatch/design-system/id-text";
import { EmptyNextSteps } from "@langwatch/design-system/no-data-info-block";
import { PageLayout } from "@langwatch/design-system/page-layout";
import {
  Badge,
  Button,
  Input,
  NativeSelect,
  Stack,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { ProductScope } from "@langwatch/design-system/product-scope";
import {
  SettingsField,
  SettingsFieldGroup,
  SettingsFieldValue,
} from "@langwatch/design-system/settings-field";
import { SettingsSection } from "@langwatch/design-system/settings-section";
import { Switch } from "@langwatch/design-system/switch";
import { Toaster, toaster } from "@langwatch/design-system/toaster";
import { useEffect, useRef, useState, type FormEvent } from "react";

/** What decides where everyone lands when they open the app. */
export type PrimaryUse = "" | "AGENT_GOVERNANCE" | "LLM_OPS";

/** The two settings that are saved together with the Save changes button. */
export interface OrganizationValues {
  name: string;
  primaryUse: PrimaryUse;
}

/** Your API's save for the form. It resolves when stored and rejects with a readable message. */
export type SaveOrganization = (values: OrganizationValues) => Promise<void>;

/** Your API's save for the switch, called with the value the reader chose. */
export type SavePresence = (enabled: boolean) => Promise<void>;

/**
 * Only the stories use this: it opens the example already in one of its states.
 * Leave it out in your application.
 */
export interface SettingsFormStart {
  /** A name typed but not yet saved. */
  name?: string;
  primaryUse?: PrimaryUse;
  /** The line under the name field, as if Save changes had just been refused. */
  problem?: string;
  /** A save in flight. */
  saving?: boolean;
  /** Shows the "Organization updated" notice. */
  saved?: boolean;
  /** A refused save, with the reason, shown above the section. */
  failure?: string;
  /** A switch change in flight. */
  switchSaving?: boolean;
  /** A refused switch change, with the reason: the switch is back where it was. */
  switchFailure?: string;
  /** The reader may look but not change. */
  readOnly?: boolean;
  /** Replaces the line under the page title. */
  description?: string;
}

const SAVED_VALUES: OrganizationValues = { name: "Support assistant team", primaryUse: "LLM_OPS" };
const SLUG = "support-assistant-team";
const DOCS = "https://docs.langwatch.ai/concepts";
const DESCRIPTION = "How your organization is named, where members land, and what they can share.";

const PRIMARY_USES: { label: string; value: PrimaryUse }[] = [
  { label: "Not set", value: "" },
  { label: "Track AI coding agents", value: "AGENT_GOVERNANCE" },
  { label: "Monitor & evaluate LLM apps", value: "LLM_OPS" },
];

const SWITCH_REFUSED = "Couldn't save. Try again.";

/** A stand-in for your API: succeeds straight away. Pass your own to call a real one. */
const saveLocally = () => Promise.resolve();

function labelOf(primaryUse: PrimaryUse): string {
  return PRIMARY_USES.find((use) => use.value === primaryUse)?.label ?? "Not set";
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : "The service did not answer.";
}

type SwitchStatus = "idle" | "saving" | "saved" | "error";

function initialStatus({
  startSaving,
  startFailure,
}: {
  startSaving: boolean;
  startFailure?: string;
}): SwitchStatus {
  if (startSaving) return "saving";
  return startFailure ? "error" : "idle";
}

/** A switch that saves itself: its own pending state, a rollback when refused, no Save button. */
function SaveOnChangeSwitch({
  label,
  checked,
  disabled,
  save,
  startSaving = false,
  startFailure,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  save: SavePresence;
  startSaving?: boolean;
  startFailure?: string;
}) {
  const [value, setValue] = useState(checked);
  const [status, setStatus] = useState<SwitchStatus>(initialStatus({ startSaving, startFailure }));
  const [reason, setReason] = useState(startFailure);

  const change = async (next: boolean) => {
    const previous = value;
    setValue(next);
    setStatus("saving");
    try {
      await save(next);
      setStatus("saved");
    } catch {
      setValue(previous);
      setReason(SWITCH_REFUSED);
      setStatus("error");
    }
  };

  return (
    <VStack align="end" gap={1}>
      <Switch
        colorPalette="accent"
        checked={value}
        disabled={disabled || status === "saving"}
        onCheckedChange={({ checked: next }) => void change(next)}
        inputProps={{ "aria-label": label }}
      />
      <Text
        textStyle="caption"
        color={status === "error" ? "fg.error" : "fg.muted"}
        role={status === "error" ? "alert" : "status"}
      >
        {status === "saving" && "Saving…"}
        {status === "saved" && "Saved"}
        {status === "error" && reason}
      </Text>
    </VStack>
  );
}

/** Marks a setting the reader can see but not change; the page says who can. */
function AdminOnly() {
  return (
    <Badge colorPalette="gray" variant="surface" size="xs" marginLeft={2}>
      Admin only
    </Badge>
  );
}

/**
 * Organization settings: Name and Primary use are saved together by Save changes, Live
 * presence saves the moment it is flipped. The application owns `save`, `savePresence`, who
 * may edit and the real data; this owns the shapes and the state of the form.
 */
export function SettingsForm({
  save = saveLocally,
  savePresence = saveLocally,
  start = {},
}: {
  save?: SaveOrganization;
  savePresence?: SavePresence;
  start?: SettingsFormStart;
}) {
  const readOnly = start.readOnly === true;
  const [saved, setSaved] = useState<OrganizationValues>(SAVED_VALUES);
  const [name, setName] = useState(start.name ?? SAVED_VALUES.name);
  const [primaryUse, setPrimaryUse] = useState<PrimaryUse>(
    start.primaryUse ?? SAVED_VALUES.primaryUse,
  );
  const [problem, setProblem] = useState(start.problem);
  const [saving, setSaving] = useState(start.saving === true);
  const [failure, setFailure] = useState(start.failure);
  const nameInput = useRef<HTMLInputElement>(null);

  const dirty = name !== saved.name || primaryUse !== saved.primaryUse;

  useEffect(() => {
    if (start.problem) nameInput.current?.focus();
    if (start.saved) announceSaved();
  }, [start.problem, start.saved]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setProblem("Name is required");
      nameInput.current?.focus();
      return;
    }
    setProblem(undefined);
    setFailure(undefined);
    setSaving(true);
    try {
      await save({ name: trimmed, primaryUse });
      setSaved({ name: trimmed, primaryUse });
      setName(trimmed);
      announceSaved();
    } catch (error) {
      setFailure(reasonOf(error));
    }
    setSaving(false);
  };

  return (
    <ProductScope product={null}>
      <PageLayout.Header description={start.description ?? DESCRIPTION}>
        <PageLayout.Heading>Organization settings</PageLayout.Heading>
      </PageLayout.Header>
      <PageLayout.Container width="fill">
        <Stack gap={4}>
          {readOnly && (
            <Banner
              status="info"
              title="Only organization admins can change these settings"
              action={
                <EmptyNextSteps
                  next={[{ kind: "docs", label: "About roles and access", href: DOCS }]}
                />
              }
            >
              You can read everything here. Ask an admin to make a change, or to make you one.
            </Banner>
          )}
          {failure && (
            <Banner
              status="error"
              title="Failed to update organization"
              action={
                <EmptyNextSteps
                  next={[{ kind: "docs", label: "Organization settings help", href: DOCS }]}
                />
              }
            >
              {failure} Your changes are still here: save again to retry.
            </Banner>
          )}
          <form id="organization-settings-form" onSubmit={(event) => void submit(event)}>
            <SettingsSection
              title="Organization"
              hint="Identity, defaults and collaboration across your projects."
              badge={
                dirty && !readOnly ? (
                  <Text textStyle="xs" color="fg.muted">
                    Unsaved changes
                  </Text>
                ) : undefined
              }
              actions={
                readOnly ? undefined : (
                  <Button
                    size="sm"
                    type="submit"
                    form="organization-settings-form"
                    colorPalette="accent"
                    loading={saving}
                  >
                    Save changes
                  </Button>
                )
              }
            >
              <SettingsFieldGroup>
                <SettingsField
                  label="Name"
                  hint="The name of your organization."
                  error={problem}
                  disabled={saving}
                >
                  {readOnly ? (
                    <SettingsFieldValue>{saved.name}</SettingsFieldValue>
                  ) : (
                    <Input
                      ref={nameInput}
                      width="full"
                      type="text"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                    />
                  )}
                </SettingsField>

                <SettingsField label="Slug" hint="The unique ID of your organization.">
                  <SettingsFieldValue>
                    <IdText value={SLUG} label="organization slug" />
                  </SettingsFieldValue>
                </SettingsField>

                <SettingsField
                  label="Primary use"
                  hint={
                    <>
                      Decides where everyone lands when opening the app; &quot;Not set&quot; keeps
                      the current behaviour.
                      {readOnly && <AdminOnly />}
                    </>
                  }
                  disabled={saving}
                >
                  {readOnly ? (
                    <SettingsFieldValue>{labelOf(saved.primaryUse)}</SettingsFieldValue>
                  ) : (
                    <NativeSelect.Root width="full">
                      <NativeSelect.Field
                        value={primaryUse}
                        onChange={(event) => {
                          const use = PRIMARY_USES.find(
                            (item) => item.value === event.target.value,
                          );
                          if (use) setPrimaryUse(use.value);
                        }}
                      >
                        {PRIMARY_USES.map((use) => (
                          <option key={use.value} value={use.value}>
                            {use.label}
                          </option>
                        ))}
                      </NativeSelect.Field>
                      <NativeSelect.Indicator />
                    </NativeSelect.Root>
                  )}
                </SettingsField>

                <SettingsField
                  label="Live presence"
                  controlAlign="end"
                  hint={
                    <>
                      Show teammates&apos; avatars, cursors and views; turning it off applies to
                      every project.
                      {readOnly && <AdminOnly />}
                    </>
                  }
                >
                  <SaveOnChangeSwitch
                    label="Live presence"
                    checked
                    disabled={readOnly}
                    save={savePresence}
                    startSaving={start.switchSaving}
                    startFailure={start.switchFailure}
                  />
                </SettingsField>
              </SettingsFieldGroup>
            </SettingsSection>
          </form>
        </Stack>
      </PageLayout.Container>
      <Toaster />
    </ProductScope>
  );
}

function announceSaved() {
  toaster.create({
    id: "organization-saved",
    type: "success",
    title: "Organization updated",
    description: "Your organization settings have been saved",
  });
}
