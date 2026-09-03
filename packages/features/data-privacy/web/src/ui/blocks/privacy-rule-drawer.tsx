import {
  Badge,
  Box,
  Button,
  createListCollection,
  Heading,
  HStack,
  Input,
  RadioGroup,
  Separator,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  CONTENT_CATEGORIES,
  type ContentCategory,
  type DataPrivacyAudienceOptions,
  type DataPrivacyConfig,
  type DataPrivacyRule,
  type DataPrivacyScopeAvailable,
  type ResolvedDataPrivacy,
} from "@langwatch/data-privacy-contract";
import { Drawer } from "@langwatch/design-system/drawer";
import { Select } from "@langwatch/design-system/select";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { Folder, HelpCircle, Plus, UserLock, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  buildRuleConfig,
  configsEqual,
  configToFormState,
  EMPTY_AUDIENCE_FORM,
  inheritedBaselineForScope,
  inheritFormState,
  isEmptyRuleConfig,
  type AudienceFormState,
  type CategoryChoice,
  type CustomAttributeFormRow,
  type PiiChoice,
  type RuleFormState,
  type SecretsChoice,
} from "../../model/data-privacy-rule-config";
import {
  ESSENTIAL_PII_ENTITY_LABELS,
  ESSENTIAL_PII_SUMMARY,
  STRICT_ADDED_PII_ENTITY_LABELS,
  STRICT_ADDED_PII_SUMMARY,
} from "../../model/pii-entity-labels";
import {
  CATEGORY_LABELS,
  DISPOSITION_LABELS,
  describeAudienceSelection,
  inheritedHint,
  PII_VALUE_LABELS,
  SCOPE_ICON,
} from "../../model/data-privacy-labels";
import {
  attributePatternError,
  customSecretPatternError,
  secretPatternError,
} from "../../model/data-privacy-patterns";
import { AudiencePicker } from "../elements/audience-picker";
import { PiiEntityToggleGroup } from "../elements/pii-entity-toggle-group";

/**
 * Writing one privacy rule, at one or more scopes.
 *
 * `platform/app/src/pages/settings/data-privacy.tsx`'s `PrivacyRuleDrawer`,
 * moved whole. Two substitutions, both the ones a feature-web package always
 * makes: the Design System's `Drawer` in place of `~/components/ui/drawer`
 * (which adds the Langy dodge and an inline error boundary, neither of which a
 * package may reach for), and a `scopePicker` RENDER PROP in place of a direct
 * `ScopeChipPicker` import — the same seam the sibling retention drawer already
 * used, and for the same reason its docblock gives: scope selection reads
 * organization data this feature does not own.
 */

/** One scope the rule is written at. Structural, so the picker stays the caller's. */
export type PrivacyScopeEntry = {
  scopeType: "ORGANIZATION" | "DEPARTMENT" | "TEAM" | "PROJECT";
  scopeId: string;
  personalOnly?: boolean;
};

const dispositionCollection = createListCollection({
  items: [
    {
      value: "inherit",
      label: "Inherit",
      description: "Use the value from the wider scope.",
    },
    {
      value: "capture",
      label: "Captured",
      description: "Stored and visible to your team.",
    },
    {
      value: "restrict",
      label: "Restricted",
      description: "Stored, visible only to the audience below.",
    },
    {
      value: "drop",
      label: "Dropped",
      description: "Stripped at ingestion, cannot be recovered.",
    },
  ],
});

const secretsChoiceCollection = createListCollection({
  items: [
    { value: "inherit", label: "Inherit" },
    { value: "on", label: "On" },
    { value: "off", label: "Off" },
  ],
});

const attributeDispositionCollection = createListCollection({
  items: [
    { value: "restrict", label: "Restricted" },
    { value: "drop", label: "Dropped" },
  ],
});

export function PrivacyRuleDrawer({
  open,
  editingRule,
  onClose,
  available,
  audienceOptions,
  effectiveTeam,
  effectiveOrganization,
  projectId,
  isSaving,
  onSave,
  scopePicker,
}: {
  open: boolean;
  editingRule: DataPrivacyRule | null;
  onClose: () => void;
  available: DataPrivacyScopeAvailable;
  audienceOptions: DataPrivacyAudienceOptions;
  effectiveTeam: ResolvedDataPrivacy | null;
  effectiveOrganization: ResolvedDataPrivacy | null;
  projectId: string;
  isSaving: boolean;
  onSave: (scopes: PrivacyScopeEntry[], config: DataPrivacyConfig) => void;
  /** Renders the scope picker in add mode, wired to `value` and `onChange`. */
  scopePicker: (props: {
    value: PrivacyScopeEntry[];
    onChange: (value: PrivacyScopeEntry[]) => void;
  }) => ReactNode;
}) {
  const [scopes, setScopes] = useState<PrivacyScopeEntry[]>([]);
  const [dispositions, setDispositions] = useState<Record<ContentCategory, CategoryChoice>>({
    input: "inherit",
    output: "inherit",
    system: "inherit",
    tools: "inherit",
  });
  const [audience, setAudience] = useState<AudienceFormState>({
    ...EMPTY_AUDIENCE_FORM,
    admins: true,
  });
  const [piiChoice, setPiiChoice] = useState<PiiChoice>("inherit");
  const [piiEntities, setPiiEntities] = useState<string[]>([]);
  const [piiExceptPatterns, setPiiExceptPatterns] = useState<string[]>([]);
  const [secretsChoice, setSecretsChoice] = useState<SecretsChoice>("inherit");
  const [secretsPatterns, setSecretsPatterns] = useState<string[]>([]);
  const [customAttributes, setCustomAttributes] = useState<CustomAttributeFormRow[]>([]);

  const togglePiiEntity = (entity: string) => {
    setPiiEntities((previous) =>
      previous.includes(entity)
        ? previous.filter((candidate) => candidate !== entity)
        : [...previous, entity],
    );
  };

  const applyForm = (form: RuleFormState) => {
    setDispositions(form.dispositions);
    setAudience(form.audience);
    setPiiChoice(form.piiChoice);
    setPiiEntities(form.piiEntities);
    setPiiExceptPatterns(form.piiExceptPatterns);
    setSecretsChoice(form.secretsChoice);
    setSecretsPatterns(form.secretsPatterns);
    setCustomAttributes(form.customAttributes);
  };

  // Open transition: seed the drawer. Edit hydrates from the rule, so a field
  // the rule does not set shows as "Inherit" rather than a concrete default. Add
  // starts every control on "Inherit", so a saved-as-is rule changes nothing.
  useEffect(() => {
    if (!open) return;
    if (editingRule) {
      setScopes([
        {
          scopeType: editingRule.scopeType,
          scopeId: editingRule.scopeId,
          ...(editingRule.personalOnly ? { personalOnly: true } : {}),
        },
      ]);
      applyForm(configToFormState(editingRule.config));
      return;
    }
    const projectInAvailable = available.projects.some((project) => project.id === projectId);
    const initialScopes: PrivacyScopeEntry[] = projectInAvailable
      ? [{ scopeType: "PROJECT", scopeId: projectId }]
      : [];
    setScopes(initialScopes);
    applyForm(inheritFormState());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editingRule]);

  // The policy a left-on-inherit field resolves to, so each control can show the
  // value it inherits. Keyed off the scope being edited (or the first picked).
  const inheritScopeType: "ORGANIZATION" | "DEPARTMENT" | "TEAM" | "PROJECT" =
    editingRule?.scopeType ?? scopes[0]?.scopeType ?? "PROJECT";
  const inheritedBaseline = inheritedBaselineForScope({
    scopeType: inheritScopeType,
    effectiveTeam,
    effectiveOrganization,
  });

  const anyRestrict =
    CONTENT_CATEGORIES.some((category) => dispositions[category] === "restrict") ||
    customAttributes.some((row) => row.disposition === "restrict");

  const config = useMemo<DataPrivacyConfig>(
    () =>
      buildRuleConfig({
        dispositions,
        audience,
        piiChoice,
        piiEntities,
        piiExceptPatterns,
        secretsChoice,
        secretsPatterns,
        customAttributes,
      }),
    [
      dispositions,
      audience,
      piiChoice,
      piiEntities,
      piiExceptPatterns,
      secretsChoice,
      secretsPatterns,
      customAttributes,
    ],
  );

  const hasInvalidPatterns =
    secretsPatterns.some((pattern) => customSecretPatternError(pattern) !== null) ||
    piiExceptPatterns.some((pattern) => secretPatternError(pattern) !== null) ||
    customAttributes.some((row) => attributePatternError(row.pattern) !== null);

  // Add: enabled once the built config persists at least one control. Edit:
  // enabled once the built config differs from the rule being edited.
  const hasChange = editingRule
    ? !configsEqual(config, editingRule.config)
    : !isEmptyRuleConfig(config);
  const canSave = scopes.length > 0 && hasChange && !hasInvalidPatterns && !isSaving;

  const editIcon = editingRule
    ? editingRule.personalOnly
      ? UserLock
      : (SCOPE_ICON[editingRule.scopeType] ?? Folder)
    : null;
  const EditIcon = editIcon;

  return (
    <Drawer.Root
      placement="end"
      size="md"
      open={open}
      onOpenChange={({ open: isOpen }) => {
        if (!isOpen) onClose();
      }}
    >
      <Drawer.Content bg="bg">
        <Drawer.Header>
          <Heading size="md">{editingRule ? "Edit privacy rule" : "Add privacy rule"}</Heading>
          <Drawer.CloseTrigger />
        </Drawer.Header>
        <Drawer.Body>
          <VStack gap={5} align="stretch">
            {editingRule && EditIcon ? (
              <VStack gap={1.5} align="start">
                <Text fontWeight="600" fontSize="sm">
                  Scope
                </Text>
                <HStack gap={2}>
                  <EditIcon size={14} />
                  <Text fontSize="sm">{editingRule.name}</Text>
                  <Badge size="sm" colorPalette="gray">
                    {editingRule.scopeType.toLowerCase()}
                  </Badge>
                  {editingRule.personalOnly && (
                    <Badge size="sm" colorPalette="purple">
                      personal
                    </Badge>
                  )}
                </HStack>
              </VStack>
            ) : (
              scopePicker({ value: scopes, onChange: setScopes })
            )}

            <VStack gap={2.5} align="stretch">
              <Text fontWeight="600" fontSize="sm">
                Content
              </Text>
              {CONTENT_CATEGORIES.map((category) => {
                const choice = dispositions[category];
                return (
                  <VStack key={category} align="stretch" gap={0.5}>
                    <HStack justifyContent="space-between" gap={4}>
                      <Text fontSize="sm">{CATEGORY_LABELS[category]}</Text>
                      <Select.Root
                        collection={dispositionCollection}
                        value={[choice]}
                        size="sm"
                        width="200px"
                        onValueChange={(details) =>
                          setDispositions((previous) => ({
                            ...previous,
                            [category]: (details.value[0] as CategoryChoice) ?? "inherit",
                          }))
                        }
                      >
                        <Select.Trigger background="bg" aria-label={CATEGORY_LABELS[category]}>
                          <Select.ValueText />
                        </Select.Trigger>
                        <Select.Content>
                          {dispositionCollection.items.map((item) => (
                            <Select.Item key={item.value} item={item}>
                              <VStack align="start" gap={0}>
                                <Text fontSize="sm">{item.label}</Text>
                                <Text fontSize="xs" color="fg.muted">
                                  {item.description}
                                </Text>
                              </VStack>
                            </Select.Item>
                          ))}
                        </Select.Content>
                      </Select.Root>
                    </HStack>
                    {choice === "inherit" && (
                      <Text fontSize="xs" color="fg.muted" textAlign="end">
                        {inheritedHint(
                          DISPOSITION_LABELS[inheritedBaseline.categories[category].disposition],
                        )}
                      </Text>
                    )}
                  </VStack>
                );
              })}
            </VStack>

            <VStack gap={2} align="stretch">
              <HStack gap={2}>
                <Text fontWeight="600" fontSize="sm">
                  Custom attributes
                </Text>
                <Tooltip
                  content="Match span attribute keys beyond the four categories, with * wildcards: restricted attributes are hidden from outside the audience, dropped ones are stripped at ingestion."
                  contentProps={{ maxWidth: "340px" }}
                >
                  <Box color="fg.muted" display="inline-flex">
                    <HelpCircle size={13} />
                  </Box>
                </Tooltip>
                <Spacer />
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() =>
                    setCustomAttributes((previous) => [
                      ...previous,
                      { pattern: "", disposition: "restrict" },
                    ])
                  }
                >
                  <Plus size={14} /> Add attribute rule
                </Button>
              </HStack>
              {customAttributes.map((row, index) => {
                const error = attributePatternError(row.pattern);
                return (
                  <VStack key={index} gap={1} align="stretch">
                    <HStack gap={2}>
                      <Input
                        size="sm"
                        fontFamily="mono"
                        placeholder="gen_ai.prompt.*"
                        value={row.pattern}
                        aria-label={`Attribute pattern ${index + 1}`}
                        borderColor={error ? "red.500" : undefined}
                        onChange={(event) =>
                          setCustomAttributes((previous) =>
                            previous.map((candidate, position) =>
                              position === index
                                ? { ...candidate, pattern: event.target.value }
                                : candidate,
                            ),
                          )
                        }
                      />
                      <Select.Root
                        collection={attributeDispositionCollection}
                        value={[row.disposition]}
                        size="sm"
                        width="160px"
                        onValueChange={(details) =>
                          setCustomAttributes((previous) =>
                            previous.map((candidate, position) =>
                              position === index
                                ? {
                                    ...candidate,
                                    disposition:
                                      (details.value[0] as "restrict" | "drop") ?? "restrict",
                                  }
                                : candidate,
                            ),
                          )
                        }
                      >
                        <Select.Trigger
                          background="bg"
                          aria-label={`Attribute disposition ${index + 1}`}
                        >
                          <Select.ValueText />
                        </Select.Trigger>
                        <Select.Content>
                          {attributeDispositionCollection.items.map((item) => (
                            <Select.Item key={item.value} item={item}>
                              {item.label}
                            </Select.Item>
                          ))}
                        </Select.Content>
                      </Select.Root>
                      <Button
                        size="xs"
                        variant="ghost"
                        aria-label={`Remove attribute rule ${index + 1}`}
                        onClick={() =>
                          setCustomAttributes((previous) =>
                            previous.filter((_, position) => position !== index),
                          )
                        }
                      >
                        <X size={14} />
                      </Button>
                    </HStack>
                    {error && (
                      <Text fontSize="xs" color="red.500">
                        {error}
                      </Text>
                    )}
                  </VStack>
                );
              })}
            </VStack>

            {anyRestrict && (
              <VStack gap={2} align="stretch">
                <Text fontWeight="600" fontSize="sm">
                  Restricted content is visible to
                </Text>
                <AudiencePicker
                  audience={audience}
                  options={audienceOptions}
                  onChange={setAudience}
                />
                <Text fontSize="xs" color="fg.muted">
                  {describeAudienceSelection(audience, audienceOptions)}
                </Text>
              </VStack>
            )}

            <Separator />

            <VStack gap={2} align="stretch">
              <VStack align="start" gap={0}>
                <Text fontWeight="600" fontSize="sm">
                  PII redaction
                </Text>
                <Text fontSize="xs" color="fg.muted">
                  Masks personal data like emails, phones, cards, and IDs in stored content.
                </Text>
              </VStack>
              <RadioGroup.Root
                value={piiChoice}
                onValueChange={(details) => {
                  const next = (details.value as PiiChoice) ?? "inherit";
                  setPiiChoice(next);
                  // Seed custom with the native essentials the first time so
                  // it starts from a sensible base the customer can pare down.
                  if (next === "custom") {
                    setPiiEntities((previous) =>
                      previous.length > 0 ? previous : Object.keys(ESSENTIAL_PII_ENTITY_LABELS),
                    );
                  }
                }}
              >
                <VStack align="start" gap={1}>
                  <RadioGroup.Item value="inherit">
                    <RadioGroup.ItemHiddenInput />
                    <RadioGroup.ItemIndicator />
                    <RadioGroup.ItemText>
                      Inherit
                      {piiChoice === "inherit" && (
                        <Text as="span" color="fg.muted">
                          {" · "}
                          {PII_VALUE_LABELS[inheritedBaseline.pii.level]}
                        </Text>
                      )}
                    </RadioGroup.ItemText>
                  </RadioGroup.Item>
                  <RadioGroup.Item value="disabled">
                    <RadioGroup.ItemHiddenInput />
                    <RadioGroup.ItemIndicator />
                    <RadioGroup.ItemText>Off</RadioGroup.ItemText>
                  </RadioGroup.Item>
                  <RadioGroup.Item value="essential">
                    <RadioGroup.ItemHiddenInput />
                    <RadioGroup.ItemIndicator />
                    <RadioGroup.ItemText>
                      Essential (emails, phones, cards, IPs, national IDs)
                    </RadioGroup.ItemText>
                    <Tooltip
                      content={`Detects and masks: ${ESSENTIAL_PII_SUMMARY}.`}
                      contentProps={{ maxWidth: "340px" }}
                    >
                      <Box color="fg.muted" display="inline-flex">
                        <HelpCircle size={13} />
                      </Box>
                    </Tooltip>
                  </RadioGroup.Item>
                  <RadioGroup.Item value="strict">
                    <RadioGroup.ItemHiddenInput />
                    <RadioGroup.ItemIndicator />
                    <RadioGroup.ItemText>
                      Strict (adds names, locations, and more)
                    </RadioGroup.ItemText>
                    <Tooltip
                      content={`Everything in Essential, plus deeper detection of: ${STRICT_ADDED_PII_SUMMARY}.`}
                      contentProps={{ maxWidth: "340px" }}
                    >
                      <Box color="fg.muted" display="inline-flex">
                        <HelpCircle size={13} />
                      </Box>
                    </Tooltip>
                  </RadioGroup.Item>
                  <RadioGroup.Item value="custom">
                    <RadioGroup.ItemHiddenInput />
                    <RadioGroup.ItemIndicator />
                    <RadioGroup.ItemText>
                      Custom (choose exactly what to redact)
                    </RadioGroup.ItemText>
                  </RadioGroup.Item>
                </VStack>
              </RadioGroup.Root>
              {piiChoice === "custom" && (
                <VStack align="stretch" gap={3} paddingLeft={6}>
                  <PiiEntityToggleGroup
                    title="Fast detection"
                    hint="Redacted instantly as data arrives, at no extra cost."
                    labels={ESSENTIAL_PII_ENTITY_LABELS}
                    selected={piiEntities}
                    onToggle={togglePiiEntity}
                  />
                  <PiiEntityToggleGroup
                    title="Deep detection"
                    hint="Also finds names and locations. May add some latency."
                    labels={STRICT_ADDED_PII_ENTITY_LABELS}
                    selected={piiEntities}
                    onToggle={togglePiiEntity}
                  />
                </VStack>
              )}
              {piiChoice !== "inherit" && piiChoice !== "disabled" && (
                <VStack gap={2} align="stretch" paddingLeft={6}>
                  <HStack gap={1}>
                    {piiExceptPatterns.length > 0 && (
                      <Text fontWeight="600" fontSize="sm">
                        Exceptions
                      </Text>
                    )}
                    {piiExceptPatterns.length > 0 && (
                      <Tooltip
                        content="A detected value that fully matches one of these regular expressions is kept as is. Use this for business identifiers that look like personal data, such as an internal reservation number detection reads as a card number. Applies to Fast detection matches; Deep detection (names, locations) can still redact a value even if it matches an exception."
                        contentProps={{ maxWidth: "340px" }}
                      >
                        <Box color="fg.muted" display="inline-flex">
                          <HelpCircle size={13} />
                        </Box>
                      </Tooltip>
                    )}
                  </HStack>
                  {piiExceptPatterns.map((pattern, index) => {
                    const error = secretPatternError(pattern);
                    return (
                      <VStack key={index} gap={1} align="stretch">
                        <HStack gap={2}>
                          <Input
                            size="sm"
                            fontFamily="mono"
                            placeholder="00[0-9]{12}"
                            value={pattern}
                            aria-label={`PII exception pattern ${index + 1}`}
                            borderColor={error ? "red.500" : undefined}
                            onChange={(event) =>
                              setPiiExceptPatterns((previous) =>
                                previous.map((candidate, position) =>
                                  position === index ? event.target.value : candidate,
                                ),
                              )
                            }
                          />
                          <Button
                            size="xs"
                            variant="ghost"
                            aria-label={`Remove PII exception pattern ${index + 1}`}
                            onClick={() =>
                              setPiiExceptPatterns((previous) =>
                                previous.filter((_, position) => position !== index),
                              )
                            }
                          >
                            <X size={14} />
                          </Button>
                        </HStack>
                        {error && (
                          <Text fontSize="xs" color="red.500">
                            {error}
                          </Text>
                        )}
                      </VStack>
                    );
                  })}
                  <Box>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => setPiiExceptPatterns((previous) => [...previous, ""])}
                    >
                      <Plus size={14} /> Add exception
                    </Button>
                  </Box>
                  {piiExceptPatterns.length === 0 && (
                    <Text fontSize="xs" color="fg.muted">
                      Keep known-safe formats that look like personal data, such as internal
                      reservation numbers.
                    </Text>
                  )}
                </VStack>
              )}
            </VStack>

            <VStack gap={2} align="stretch">
              <HStack justifyContent="space-between" gap={4} align="start">
                <VStack align="start" gap={0}>
                  <Text fontWeight="600" fontSize="sm">
                    Secrets redaction
                  </Text>
                  <Text fontSize="xs" color="fg.muted">
                    Scrubs API keys, tokens, private keys, and database URLs. On by default.
                  </Text>
                </VStack>
                <Select.Root
                  collection={secretsChoiceCollection}
                  value={[secretsChoice]}
                  size="sm"
                  width="120px"
                  onValueChange={(details) =>
                    setSecretsChoice((details.value[0] as SecretsChoice) ?? "inherit")
                  }
                >
                  <Select.Trigger background="bg" aria-label="Secrets redaction">
                    <Select.ValueText />
                  </Select.Trigger>
                  <Select.Content>
                    {secretsChoiceCollection.items.map((item) => (
                      <Select.Item key={item.value} item={item}>
                        {item.label}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
              </HStack>
              {secretsChoice === "inherit" && (
                <Text fontSize="xs" color="fg.muted" textAlign="end">
                  {inheritedHint(inheritedBaseline.secrets.enabled ? "On" : "Off")}
                </Text>
              )}
              {secretsChoice === "on" && (
                <VStack gap={2} align="stretch" paddingLeft={6}>
                  {secretsPatterns.length > 0 && (
                    <Text fontWeight="600" fontSize="sm">
                      Custom patterns
                    </Text>
                  )}
                  {secretsPatterns.map((pattern, index) => {
                    const error = customSecretPatternError(pattern);
                    return (
                      <VStack key={index} gap={1} align="stretch">
                        <HStack gap={2}>
                          <Input
                            size="sm"
                            fontFamily="mono"
                            placeholder="acme_live_[a-z0-9]+"
                            value={pattern}
                            aria-label={`Custom secret pattern ${index + 1}`}
                            borderColor={error ? "red.500" : undefined}
                            onChange={(event) =>
                              setSecretsPatterns((previous) =>
                                previous.map((candidate, position) =>
                                  position === index ? event.target.value : candidate,
                                ),
                              )
                            }
                          />
                          <Button
                            size="xs"
                            variant="ghost"
                            aria-label={`Remove custom secret pattern ${index + 1}`}
                            onClick={() =>
                              setSecretsPatterns((previous) =>
                                previous.filter((_, position) => position !== index),
                              )
                            }
                          >
                            <X size={14} />
                          </Button>
                        </HStack>
                        {error && (
                          <Text fontSize="xs" color="red.500">
                            {error}
                          </Text>
                        )}
                      </VStack>
                    );
                  })}
                  <Box>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => setSecretsPatterns((previous) => [...previous, ""])}
                    >
                      <Plus size={14} /> Add custom pattern
                    </Button>
                  </Box>
                  <Text fontSize="xs" color="fg.muted">
                    Extra regular expressions redacted on top of the built-in catalog.
                  </Text>
                </VStack>
              )}
            </VStack>
          </VStack>
        </Drawer.Body>
        <Drawer.Footer>
          <HStack width="full" justify="end">
            <Button
              colorPalette="blue"
              disabled={!canSave}
              loading={isSaving}
              onClick={() => {
                if (scopes.length === 0) return;
                onSave(scopes, config);
              }}
            >
              Save
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}
