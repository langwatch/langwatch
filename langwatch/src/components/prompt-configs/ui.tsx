import { useEffect, useState } from "react";
import {
  Box,
  Button,
  Card,
  Field,
  HStack,
  Input,
  NativeSelect,
  Spacer,
  Text,
  Textarea,
  VStack,
  Badge,
} from "@chakra-ui/react";
import {
  useFieldArray,
  useForm,
  type UseFormReturn,
  type FieldArrayWithId,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  ChevronDown,
  Clock,
  Plus,
,
  Trash2,
  User,
} from "react-feather";
import { api } from "../../utils/api";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { toaster } from "../ui/toaster";
import { formatDistanceToNow } from "date-fns";
import { Avatar } from "@chakra-ui/react";

// Types and Schemas ==========================================

export type FieldType = {
  identifier: string;
  type: string;
  value?: any;
  desc?: string;
  optional?: boolean;
};

const fieldSchema = z.object({
  identifier: z.string().min(1, "Identifier is required"),
  type: z.string().min(1, "Type is required"),
  value: z.any().optional(),
  desc: z.string().optional(),
  optional: z.boolean().optional(),
});

// Schema for the config content form
const promptConfigContentSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  prompt: z.string().default("You are a helpful assistant"),
  model: z.string().default("openai/gpt4-o-mini"),
  inputs: z.array(fieldSchema.omit({ value: true, optional: true })),
  outputs: z.array(fieldSchema.omit({ value: true, optional: true })),
});

// Schema for the version form (just the commit message)
const versionFormSchema = z.object({
  commitMessage: z.string().min(1, "Commit message is required"),
  schemaVersion: z.string().min(1, "Schema version is required"),
});

export type PromptConfigContentFormValues = z.infer<
  typeof promptConfigContentSchema
>;
export type VersionFormValues = z.infer<typeof versionFormSchema>;

// Types for versions display
export type PromptConfigVersion = {
  id: string;
  version: string;
  commitMessage?: string | null;
  schemaVersion: string;
  createdAt: Date;
  author?: {
    id: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
  } | null;
  isAutosaved?: boolean;
  isCurrent?: boolean;
  projectId?: string;
};

// Atomic UI Components ======================================

/**
 * Displays a type label with consistent styling
 */
function TypeLabel({ type }: { type: string }) {
  return (
    <Text
      background="gray.100"
      paddingX={2}
      paddingY={1}
      borderRadius="md"
      fontSize="xs"
    >
      {type}
    </Text>
  );
}

/**
 * Header for a field group with title and add button
 */
function FieldGroupHeader({
  title,
  onAdd,
  readOnly,
}: {
  title: string;
  onAdd: () => void;
  readOnly?: boolean;
}) {
  return (
    <HStack width="full">
      <Text fontSize="sm" fontWeight="semibold">
        {title}
      </Text>
      <Spacer />
      {!readOnly && (
        <Button size="xs" variant="ghost" onClick={onAdd}>
          <Plus size={16} />
        </Button>
      )}
    </HStack>
  );
}

// Enhanced field type for type safety
type EnhancedFieldArrayWithId = FieldArrayWithId & FieldType;

/**
 * A single field row with identifier and type
 */
function FieldRow({
  field,
  index,
  name,
  onChange,
  onRemove,
  readOnly,
  error,
  validateIdentifier,
}: {
  field: EnhancedFieldArrayWithId;
  index: number;
  name: "inputs" | "outputs";
  onChange: (indexOrPath: string, value: any) => void;
  onRemove: () => void;
  readOnly?: boolean;
  error?: { message?: string };
  validateIdentifier: (value: string) => true | string;
}) {
  return (
    <Field.Root key={field.id} invalid={!!error}>
      <HStack width="full">
        <HStack
          background="gray.100"
          paddingRight={2}
          borderRadius="8px"
          width="full"
        >
          {!readOnly ? (
            <Input
              name={`${name}.${index}.identifier`}
              onChange={(e) => {
                const normalized = e.target.value
                  .replace(/ /g, "_")
                  .toLowerCase();
                onChange(`${name}.${index}.identifier`, normalized);
              }}
              onBlur={(e) => {
                validateIdentifier(e.target.value);
              }}
              defaultValue={field.identifier || ""}
              width="full"
              fontFamily="monospace"
              fontSize="13px"
              border="none"
              background="transparent"
              padding="6px 0px 6px 12px"
            />
          ) : (
            <Text
              fontFamily="monospace"
              fontSize="13px"
              width="full"
              padding="8px 0px 8px 12px"
            >
              {field.identifier}
            </Text>
          )}
          <TypeSelector
            name={`${name}.${index}.type`}
            value={field.type || "str"}
            onChange={(value) => onChange(`${name}.${index}.type`, value)}
            isInput={name === "inputs"}
            readOnly={readOnly}
          />
        </HStack>
        {!readOnly && (
          <Button
            colorPalette="gray"
            size="sm"
            height="40px"
            onClick={onRemove}
          >
            <Trash2 size={18} />
          </Button>
        )}
      </HStack>
      {error?.message && <Field.ErrorText>{error.message}</Field.ErrorText>}
    </Field.Root>
  );
}

/**
 * Type selector with dropdown for field types
 */
function TypeSelector({
  name,
  value,
  onChange,
  isInput,
  readOnly,
}: {
  name: string;
  value: string;
  onChange: (value: string) => void;
  isInput?: boolean;
  readOnly?: boolean;
}) {
  return (
    <HStack
      position="relative"
      background="white"
      borderRadius="8px"
      paddingX={2}
      paddingY={1}
      gap={2}
      height="full"
    >
      <Box fontSize="13px">
        <TypeLabel type={value} />
      </Box>
      {!readOnly && (
        <>
          <Box color="gray.600">
            <ChevronDown size={14} />
          </Box>
          <NativeSelect.Root
            position="absolute"
            top={0}
            left={0}
            height="32px"
            width="100%"
            cursor="pointer"
            zIndex={10}
            opacity={0}
          >
            <NativeSelect.Field
              name={name}
              value={value}
              onChange={(e) => onChange(e.target.value)}
            >
              <option value="str">str</option>
              {isInput && <option value="image">image</option>}
              <option value="float">float</option>
              <option value="int">int</option>
              <option value="bool">bool</option>
              <option value="llm">llm</option>
              <option value="prompting_technique">prompting_technique</option>
              <option value="dataset">dataset</option>
              <option value="code">code</option>
              <option value="list[str]">list[str]</option>
            </NativeSelect.Field>
          </NativeSelect.Root>
        </>
      )}
    </HStack>
  );
}

/**
 * Reusable component for a group of fields (inputs, outputs)
 */
function ConfigFieldGroup({
  title,
  name,
  form,
  readOnly,
}: {
  title: string;
  name: "inputs" | "outputs";
  form: UseFormReturn<PromptConfigContentFormValues>;
  readOnly?: boolean;
}) {
  const { control, formState, setValue, getValues } = form;
  const { errors } = formState;

  const { fields, append, remove } = useFieldArray({
    control,
    name,
  });

  const handleAddField = () => {
    append({ identifier: "", type: "str" });
  };

  const handleSetValue = (path: string, value: any) => {
    setValue(path as any, value, { shouldValidate: true });
  };

  const validateIdentifier = (index: number, value: string) => {
    const currentFields = getValues(name);

    if (Array.isArray(currentFields)) {
      const identifierCount = currentFields.filter(
        (f, i) => f.identifier === value && i !== index
      ).length;

      if (identifierCount > 0) {
        setValue(`${name}.${index}.identifier` as any, value, {
          shouldValidate: true,
        });
        return "Duplicate identifier";
      }
    }

    return true;
  };

  return (
    <VStack align="start" gap={3} width="full">
      <FieldGroupHeader
        title={title}
        onAdd={handleAddField}
        readOnly={readOnly}
      />

      {fields.map((field, index) => (
        <FieldRow
          key={field.id}
          field={field as unknown as EnhancedFieldArrayWithId}
          index={index}
          name={name}
          onChange={handleSetValue}
          onRemove={() => remove(index)}
          readOnly={readOnly}
          error={(errors[name] as any)?.[index]?.identifier}
          validateIdentifier={(value) => validateIdentifier(index, value)}
        />
      ))}
    </VStack>
  );
}

// Form Components ==========================================

/**
 * Component for displaying version information and commit form
 */
function PromptConfigVersionsUI({
  currentVersion,
  versions,
  onSaveNewVersion,
  onRestoreVersion,
  isSubmitting,
  onVersionSelect,
}: {
  currentVersion: string;
  versions: PromptConfigVersion[];
  onSaveNewVersion: (values: VersionFormValues) => void;
  onRestoreVersion: (version: PromptConfigVersion) => void;
  isSubmitting: boolean;
  onVersionSelect: (version: PromptConfigVersion) => void;
}) {
  const versionForm = useForm<VersionFormValues>({
    resolver: zodResolver(versionFormSchema),
    defaultValues: {
      commitMessage: "",
      schemaVersion: "1.0",
    },
  });

  const { register, handleSubmit, formState } = versionForm;
  const { errors } = formState;

  return (
    <VStack align="stretch" gap={6} width="full">
      <Text fontSize="xl" fontWeight="bold">
        Prompt Config Versions
      </Text>

      <HStack alignItems="flex-end" gap={4}>
        <VStack align="start" flex="1">
            
            <Text fontWeight="bold">VERSION</Text>
            <Text fontWeight="bold" flex="1">
              DESCRIPTION
            </Text>
          </HStack>

          <HStack width="full">
            {versions.length > 0 ? (
              <NativeSelect.Root size="md">
                <NativeSelect.Field
                  value={currentVersion}
                  onChange={(e) => {
                    const selectedVersion = versions.find(
                      (v) => v.version === e.target.value
                    );
                    if (selectedVersion) onVersionSelect(selectedVersion);
                  }}
                >
                  {versions.map((version) => (
                    <option key={version.id} value={version.version}>
                      {version.version} -{" "}
                      {version.commitMessage || "No commit message"}
                    </option>
                  ))}
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
            ) : (
              <Text fontSize="md" fontWeight="medium">
                {currentVersion}
              </Text>
            )}
            <Field.Root invalid={!!errors.commitMessage} flex="1">
              <Input
                {...register("commitMessage")}
                placeholder="What changes have you made?"
              />
              {errors.commitMessage && (
                <Field.ErrorText>
                  {errors.commitMessage.message}
                </Field.ErrorText>
              )}
            </Field.Root>
          </HStack>

          <Field.Root invalid={!!errors.schemaVersion} width="100%">
            <Field.Label>Schema Version</Field.Label>
            <Input {...register("schemaVersion")} placeholder="e.g., 1.0" />
            <Field.HelperText>
              Version of the schema being used
            </Field.HelperText>
            {errors.schemaVersion && (
              <Field.ErrorText>{errors.schemaVersion.message}</Field.ErrorText>
            )}
          </Field.Root>
        </VStack>

        <Button
          colorPalette="orange"
          onClick={handleSubmit(onSaveNewVersion)}
          loading={isSubmitting}
        >
          Save new version
        </Button>
      </HStack>
    </VStack>
  );
}

/**
 * Dumb Form Component for editing the config content
 */
export function PromptConfigContentFormUI({
  initialValues,
  onSubmit,
  isSubmitting,
  submitLabel = "Save",
  readOnly = false,
  onNameEdit,
}: {
  initialValues: Partial<PromptConfigContentFormValues>;
  onSubmit: (values: PromptConfigContentFormValues) => void;
  isSubmitting: boolean;
  submitLabel?: string;
  readOnly?: boolean;
  onNameEdit?: (name: string) => void;
}) {
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(initialValues.name || "");

  // Form setup with schema validation
  const form = useForm<PromptConfigContentFormValues>({
    resolver: zodResolver(promptConfigContentSchema),
    defaultValues: {
      name: initialValues.name || "",
      description: initialValues.description || "",
      prompt: initialValues.prompt || "You are a helpful assistant",
      model: initialValues.model || "openai/gpt4-o-mini",
      inputs: initialValues.inputs || [{ identifier: "input", type: "str" }],
      outputs: initialValues.outputs || [{ identifier: "output", type: "str" }],
    },
  });

  const { handleSubmit, register, formState, setValue } = form;
  const { errors } = formState;

  useEffect(() => {
    if (initialValues.name) {
      setNameValue(initialValues.name);
    }
  }, [initialValues.name]);

  const handleNameBlur = () => {
    setIsEditingName(false);
    if (onNameEdit && nameValue !== initialValues.name) {
      onNameEdit(nameValue);
      setValue("name", nameValue);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <VStack align="stretch" gap={6}>
        <Field.Root invalid={!!errors.name}>
          <Field.Label>Configuration Name</Field.Label>
          {isEditingName ? (
            <Input
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              onBlur={handleNameBlur}
              autoFocus
            />
          ) : (
            <Box
              p={2}
              borderWidth="1px"
              borderColor="gray.200"
              borderRadius="md"
              cursor="pointer"
              _hover={{ bg: "gray.50" }}
              onClick={() => setIsEditingName(true)}
            >
              {nameValue}
            </Box>
          )}
          {errors.name && (
            <Field.ErrorText>{errors.name.message}</Field.ErrorText>
          )}
        </Field.Root>

        <Field.Root invalid={!!errors.description}>
          <Field.Label>Description</Field.Label>
          <Textarea
            {...register("description")}
            placeholder="Describe the purpose of this configuration"
            rows={2}
            readOnly={readOnly}
          />
          {errors.description && (
            <Field.ErrorText>{errors.description.message}</Field.ErrorText>
          )}
        </Field.Root>

        <Field.Root invalid={!!errors.model}>
          <Field.Label>Model</Field.Label>
          <Input
            {...register("model")}
            placeholder="openai/gpt4-o-mini"
            readOnly={readOnly}
          />
          {errors.model && (
            <Field.ErrorText>{errors.model.message}</Field.ErrorText>
          )}
        </Field.Root>

        <Field.Root invalid={!!errors.prompt}>
          <Field.Label>Prompt</Field.Label>
          <Textarea
            {...register("prompt")}
            placeholder="You are a helpful assistant"
            rows={4}
            readOnly={readOnly}
          />
          {errors.prompt && (
            <Field.ErrorText>{errors.prompt.message}</Field.ErrorText>
          )}
        </Field.Root>

        <ConfigFieldGroup
          title="Inputs"
          name="inputs"
          form={form}
          readOnly={readOnly}
        />

        <ConfigFieldGroup
          title="Outputs"
          name="outputs"
          form={form}
          readOnly={readOnly}
        />

        {!readOnly && (
          <HStack justifyContent="flex-end">
            <Button type="submit" colorPalette="orange" loading={isSubmitting}>
              {submitLabel}
            </Button>
          </HStack>
        )}
      </VStack>
    </form>
  );
}

// Hook for API operations ==================================

/**
 * Hook for prompt config API operations
 */
export function usePromptConfigApi() {
  const { project } = useOrganizationTeamProject();
  const utils = api.useContext();

  // Query to get the next sequence number for new prompts
  const getPromptConfigCount = api.llmConfigs.getPromptConfigCount.useQuery(
    { projectId: project?.id || "" },
    { enabled: !!project?.id }
  );

  const getConfig = api.llmConfigs.getPromptConfig.useQuery;

  const createConfig = api.llmConfigs.createPromptConfig.useMutation({
    onSuccess: (data) => {
      toaster.create({
        title: "Success",
        description: "Configuration created successfully",
        type: "success",
        placement: "top-end",
        meta: { closable: true },
      });
      utils.llmConfigs.getPromptConfigCount.invalidate();
      return data;
    },
    onError: (error) => {
      toaster.create({
        title: "Error",
        description: `Failed to create configuration: ${error.message}`,
        type: "error",
        placement: "top-end",
        meta: { closable: true },
      });
      throw error;
    },
  });

  const updateConfigName = api.llmConfigs.updatePromptConfigName.useMutation({
    onSuccess: () => {
      toaster.create({
        title: "Success",
        description: "Configuration name updated",
        type: "success",
        placement: "top-end",
        meta: { closable: true },
      });
    },
    onError: (error) => {
      toaster.create({
        title: "Error",
        description: `Failed to update name: ${error.message}`,
        type: "error",
        placement: "top-end",
        meta: { closable: true },
      });
    },
  });

  const createVersion = api.llmConfigs.createPromptConfigVersion.useMutation({
    onSuccess: (data) => {
      toaster.create({
        title: "Success",
        description: "New version created successfully",
        type: "success",
        placement: "top-end",
        meta: { closable: true },
      });
      return data;
    },
    onError: (error) => {
      toaster.create({
        title: "Error",
        description: `Failed to create version: ${error.message}`,
        type: "error",
        placement: "top-end",
        meta: { closable: true },
      });
      throw error;
    },
  });

  const getDefaultConfig = () => {
    const sequenceNum = getPromptConfigCount.data?.count || 1;
    return {
      name: `new-prompt-${sequenceNum}`,
      description: "",
      prompt: "You are a helpful assistant",
      model: "openai/gpt4-o-mini",
      inputs: [{ identifier: "input", type: "str" }],
      outputs: [{ identifier: "output", type: "str" }],
    };
  };

  const createNewConfig = async (
    values: PromptConfigContentFormValues,
    versionInfo: { schemaVersion: string; commitMessage: string }
  ) => {
    if (!project?.id) {
      toaster.create({
        title: "Error",
        description: "Project ID is missing",
        type: "error",
        placement: "top-end",
        meta: { closable: true },
      });
      throw new Error("Project ID is missing");
    }

    const { name, description, prompt, model, inputs, outputs } = values;
    const { schemaVersion, commitMessage } = versionInfo;

    // Prepare the config data
    const configData = {
      name,
      description,
      prompt,
      model,
      inputs,
      outputs,
    };

    return createConfig.mutateAsync({
      projectId: project.id,
      name,
      configData,
      schemaVersion,
      commitMessage,
    });
  };

  const updateName = async (configId: string, name: string) => {
    if (!project?.id) {
      toaster.create({
        title: "Error",
        description: "Project ID is missing",
        type: "error",
        placement: "top-end",
        meta: { closable: true },
      });
      throw new Error("Project ID is missing");
    }

    return updateConfigName.mutateAsync({
      projectId: project.id,
      configId,
      name,
    });
  };

  const createNewVersion = async (
    configId: string,
    values: PromptConfigContentFormValues,
    versionInfo: { schemaVersion: string; commitMessage: string }
  ) => {
    if (!project?.id) {
      toaster.create({
        title: "Error",
        description: "Project ID is missing",
        type: "error",
        placement: "top-end",
        meta: { closable: true },
      });
      throw new Error("Project ID is missing");
    }

    const { name, description, prompt, model, inputs, outputs } = values;
    const { schemaVersion, commitMessage } = versionInfo;

    // Prepare the config data
    const configData = {
      name,
      description,
      prompt,
      model,
      inputs,
      outputs,
    };

    return createVersion.mutateAsync({
      projectId: project.id,
      configId,
      configData,
      schemaVersion,
      commitMessage,
    });
  };

  const getVersions = api.llmConfigs.getPromptConfigVersions.useQuery;

  return {
    createNewConfig,
    createNewVersion,
    getVersions,
    getConfig,
    getDefaultConfig,
    updateName,
    isCreatingConfig: createConfig.isLoading,
    isCreatingVersion: createVersion.isLoading,
    isUpdatingName: updateConfigName.isLoading,
  };
}

// Combined Component for all functionality ==================

/**
 * Combined component for editing a prompt config with version management
 */
export function PromptConfigEditorWithVersions({
  configId,
  initialValues,
  latestVersion,
  onSuccess,
  readOnly = false,
  mode,
}: {
  configId?: string;
  initialValues?: Partial<PromptConfigContentFormValues>;
  latestVersion?: string;
  onSuccess?: () => void;
  readOnly?: boolean;
  mode: "create" | "edit" | "view";
}) {
  const {
    createNewConfig,
    createNewVersion,
    getVersions,
    updateName,
    isCreatingConfig,
    isCreatingVersion,
    isUpdatingName,
  } = usePromptConfigApi();
  const { project } = useOrganizationTeamProject();

  // State for selected version
  const [selectedVersion, setSelectedVersion] =
    useState<PromptConfigVersion | null>(null);

  // Fetch versions if configId is provided (for edit/view modes)
  const { data: versionsData, isLoading: isLoadingVersions } = configId
    ? getVersions(
        { configId, projectId: project?.id || "" },
        { enabled: !!configId && !!project?.id }
      )
    : { data: undefined, isLoading: false };

  const versions = versionsData || [];
  const currentVersionNumber =
    latestVersion ||
    (versions.length > 0 && versions[0] ? versions[0].version : "1.0");

  // Handle name edit
  const handleNameEdit = async (name: string) => {
    if (configId && mode === "edit") {
      try {
        await updateName(configId, name);
      } catch (error) {
        // Error is handled by the API hook
      }
    }
  };

  // Handle form submissions
  const handleContentSubmit = async (values: PromptConfigContentFormValues) => {
    // For content updates, we'll need to request a commit message separately
    // This could be via a modal or other UI, but for now we just set a default
    const defaultVersionInfo = {
      schemaVersion: "1.0",
      commitMessage: "Updated configuration",
    };

    try {
      if (mode === "create") {
        await createNewConfig(values, defaultVersionInfo);
      } else if (mode === "edit" && configId) {
        await createNewVersion(configId, values, defaultVersionInfo);
      }
      onSuccess?.();
    } catch (error) {
      // Error is handled by the API hook
    }
  };

  const handleSaveNewVersion = async (versionValues: VersionFormValues) => {
    if (!configId || mode !== "edit") return;

    try {
      // We need to get the current content values - this would need to be handled by state or ref in a real implementation
      // For now, we'll assume initialValues is current
      await createNewVersion(
        configId,
        initialValues as PromptConfigContentFormValues,
        versionValues
      );
      onSuccess?.();
    } catch (error) {
      // Error is handled by the API hook
    }
  };

  const handleVersionSelect = (version: PromptConfigVersion) => {
    setSelectedVersion(version);
    // This would load the content of this version
    // In a real implementation, you'd fetch the content of this version
    toaster.create({
      title: "Info",
      description: `Selected version ${version.version}`,
      type: "info",
      placement: "top-end",
      meta: { closable: true },
    });
  };

  const handleRestoreVersion = async (version: PromptConfigVersion) => {
    if (!configId || mode !== "edit") return;

    // Implementation would fetch the content of this version and load it in the editor
    // Then prompt user for a commit message before saving
    toaster.create({
      title: "Info",
      description: `Restore version ${version.version} - This would load the version content in the editor`,
      type: "info",
      placement: "top-end",
      meta: { closable: true },
    });
  };

  // For edit/view modes, show both content form and versions
  return (
    <VStack gap={10} align="stretch" width="full">
      {/* Show versions panel at the top */}
      <PromptConfigVersionsUI
        currentVersion={currentVersionNumber}
        versions={versions}
        onSaveNewVersion={handleSaveNewVersion}
        onRestoreVersion={handleRestoreVersion}
        isSubmitting={isCreatingVersion}
        onVersionSelect={handleVersionSelect}
      />

      {/* Content editing form below */}
      <PromptConfigContentFormUI
        initialValues={initialValues || {}}
        onSubmit={handleContentSubmit}
        isSubmitting={isCreatingConfig}
        submitLabel="Update Configuration"
        readOnly={readOnly}
        onNameEdit={handleNameEdit}
      />
    </VStack>
  );
}

/**
 * Main entry point component with simpler props
 */
export function PromptConfigForm({
  configId,
  onSuccess,
  readOnly = false,
  mode,
}: {
  configId?: string;
  onSuccess?: () => void;
  readOnly?: boolean;
  mode: "create" | "edit" | "view";
}) {
  const { getConfig, getDefaultConfig } = usePromptConfigApi();
  const [initialValues, setInitialValues] =
    useState<Partial<PromptConfigContentFormValues>>();

  // Fetch the config if an ID is provided
  const { data: configData, isLoading } = configId
    ? getConfig({ configId }, { enabled: !!configId })
    : { data: undefined, isLoading: false };

  useEffect(() => {
    if (configId && configData) {
      // If we have a config ID and data, use it
      setInitialValues(configData);
    } else if (!configId) {
      // If no config ID, use default values
      setInitialValues(getDefaultConfig());
    }
  }, [configId, configData, getDefaultConfig]);

  if (isLoading || !initialValues) {
    return (
      <VStack align="center" justifyContent="center" height="400px">
        <Text>Loading prompt configuration...</Text>
      </VStack>
    );
  }

  return (
    <PromptConfigEditorWithVersions
      configId={configId}
      initialValues={initialValues}
      onSuccess={onSuccess}
      readOnly={readOnly}
      mode={mode}
    />
  );
}
