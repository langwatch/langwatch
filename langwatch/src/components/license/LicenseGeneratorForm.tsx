import { useState, useImperativeHandle, forwardRef, useEffect, useCallback, useRef } from "react";
import {
  Box,
  Button,
  Checkbox,
  createListCollection,
  Field,
  HStack,
  Input,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { Upload, X } from "lucide-react";
import { api } from "~/utils/api";
import { toaster } from "../ui/toaster";
import { Radio, RadioGroup } from "~/components/ui/radio";
import { Select } from "~/components/ui/select";
import { ENTERPRISE_TEMPLATE } from "../../../ee/licensing/planTemplates";
import { getPlanDefaults, type PlanType } from "./planFormDefaults";
import { formatFileSize } from "./licenseStatusUtils";

const planTypeCollection = createListCollection({
  items: [
    { label: "Pro", value: "PRO" },
    { label: "Enterprise", value: "ENTERPRISE" },
    { label: "Custom", value: "CUSTOM" },
  ],
});

const usageUnitCollection = createListCollection({
  items: [
    { label: "Traces", value: "traces" },
    { label: "Events (traces + evaluations + experiments)", value: "events" },
  ],
});

type PrivateKeyInputMethod = "file" | "key";

interface LicenseGeneratorFormProps {
  organizationId: string;
  onGeneratedLicenseChange?: (hasLicense: boolean) => void;
  onFormStateChange?: (state: { isGenerating: boolean; isFormValid: boolean }) => void;
}

export interface LicenseGeneratorFormRef {
  handleGenerate: () => void;
  isGenerating: boolean;
  isFormValid: boolean;
  hasGeneratedLicense: boolean;
}

interface FormData {
  privateKey: string;
  organizationName: string;
  email: string;
  expiresAt: string;
  planType: PlanType;
  maxMembers: number;
  maxMembersLite: number;
  maxTeams: number;
  maxProjects: number;
  maxMessagesPerMonth: number;
  evaluationsCredit: number;
  maxWorkflows: number;
  maxPrompts: number;
  maxEvaluators: number;
  maxScenarios: number;
  maxAgents: number;
  maxExperiments: number;
  canPublish: boolean;
  usageUnit: "traces" | "events";
}

// Calculate default expiration date (1 year from now)
function getDefaultExpirationDate(): string {
  const oneYearFromNow = new Date();
  oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);
  // Split always returns at least one element, so first element is guaranteed
  return oneYearFromNow.toISOString().split('T')[0] ?? '';
}

const defaultFormData: FormData = {
  privateKey: "",
  organizationName: "",
  email: "",
  expiresAt: getDefaultExpirationDate(),
  planType: "ENTERPRISE",
  maxMembers: ENTERPRISE_TEMPLATE.maxMembers,
  maxMembersLite: ENTERPRISE_TEMPLATE.maxMembersLite ?? 50,
  maxTeams: ENTERPRISE_TEMPLATE.maxTeams ?? 100,
  maxProjects: ENTERPRISE_TEMPLATE.maxProjects,
  maxMessagesPerMonth: ENTERPRISE_TEMPLATE.maxMessagesPerMonth,
  evaluationsCredit: ENTERPRISE_TEMPLATE.evaluationsCredit,
  maxWorkflows: ENTERPRISE_TEMPLATE.maxWorkflows,
  maxPrompts: ENTERPRISE_TEMPLATE.maxPrompts ?? 1000,
  maxEvaluators: ENTERPRISE_TEMPLATE.maxEvaluators ?? 1000,
  maxScenarios: ENTERPRISE_TEMPLATE.maxScenarios ?? 1000,
  maxAgents: ENTERPRISE_TEMPLATE.maxAgents ?? 1000,
  maxExperiments: ENTERPRISE_TEMPLATE.maxExperiments ?? 1000,
  canPublish: ENTERPRISE_TEMPLATE.canPublish,
  usageUnit: (ENTERPRISE_TEMPLATE.usageUnit as "traces" | "events") ?? "traces",
};

function downloadLicenseFile(license: string, organizationName: string) {
  const sanitizedName = organizationName.replace(/[\/\\:*?"<>|]/g, "_");
  const blob = new Blob([license], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${sanitizedName}.langwatch-license`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
}

function NumberField({ label, value, onChange }: NumberFieldProps) {
  return (
    <Field.Root flex={1}>
      <Field.Label fontSize="xs" color="fg.muted">{label}</Field.Label>
      <Input
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value) || 0)}
        type="number"
      />
    </Field.Root>
  );
}

export const LicenseGeneratorForm = forwardRef<LicenseGeneratorFormRef, LicenseGeneratorFormProps>(
  function LicenseGeneratorForm({ organizationId, onGeneratedLicenseChange, onFormStateChange }, ref) {
    const [formData, setFormData] = useState<FormData>(defaultFormData);
    const [generatedLicense, setGeneratedLicense] = useState<string>("");
    const [privateKeyInputMethod, setPrivateKeyInputMethod] = useState<PrivateKeyInputMethod>("file");
    const [uploadedKeyFile, setUploadedKeyFile] = useState<File | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const generateMutation = api.license.generate.useMutation({
      onSuccess: (data) => {
        setGeneratedLicense(data.licenseKey);
        onGeneratedLicenseChange?.(true);
        // Auto-download the license file
        downloadLicenseFile(data.licenseKey, formData.organizationName);
        toaster.create({
          title: "License generated and downloaded",
          description: `License saved as ${formData.organizationName.replace(/[\/\\:*?"<>|]/g, "_")}.langwatch-license`,
          type: "success",
        });
      },
      onError: (error) => {
        toaster.create({
          title: "Failed to generate license",
          description: error.message,
          type: "error",
        });
      },
    });

    const handlePlanTypeChange = (newPlanType: PlanType) => {
      const defaults = getPlanDefaults(newPlanType);
      setFormData((prev) => ({
        ...prev,
        planType: newPlanType,
        ...defaults,
      }));
    };

    const handleInputChange = (field: keyof FormData, value: string | number | boolean) => {
      setFormData((prev) => ({ ...prev, [field]: value }));
    };

    const handlePrivateKeyMethodChange = (method: PrivateKeyInputMethod) => {
      setPrivateKeyInputMethod(method);
      // Clear the key when switching methods
      if (method === "file") {
        setFormData((prev) => ({ ...prev, privateKey: "" }));
      } else {
        setUploadedKeyFile(null);
        setFormData((prev) => ({ ...prev, privateKey: "" }));
      }
    };

    const handleKeyFileSelect = useCallback((file: File) => {
      setUploadedKeyFile(file);
      // Read the file content and set it as the private key
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        setFormData((prev) => ({ ...prev, privateKey: content }));
      };
      reader.readAsText(file);
    }, []);

    const handleDragOver = useCallback((e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(true);
    }, []);

    const handleDragLeave = useCallback(() => {
      setIsDragging(false);
    }, []);

    const handleDrop = useCallback(
      (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) handleKeyFileSelect(file);
      },
      [handleKeyFileSelect]
    );

    const handleDropzoneClick = useCallback(() => {
      fileInputRef.current?.click();
    }, []);

    const handleFileInputChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) handleKeyFileSelect(file);
      },
      [handleKeyFileSelect]
    );

    const handleRemoveKeyFile = useCallback(() => {
      setUploadedKeyFile(null);
      setFormData((prev) => ({ ...prev, privateKey: "" }));
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }, []);

    const handleGenerate = () => {
      generateMutation.mutate({
        organizationId,
        privateKey: formData.privateKey,
        organizationName: formData.organizationName,
        email: formData.email,
        expiresAt: new Date(formData.expiresAt),
        planType: formData.planType,
        plan: {
          maxMembers: formData.maxMembers,
          maxMembersLite: formData.maxMembersLite,
          maxTeams: formData.maxTeams,
          maxProjects: formData.maxProjects,
          maxMessagesPerMonth: formData.maxMessagesPerMonth,
          evaluationsCredit: formData.evaluationsCredit,
          maxWorkflows: formData.maxWorkflows,
          maxPrompts: formData.maxPrompts,
          maxEvaluators: formData.maxEvaluators,
          maxScenarios: formData.maxScenarios,
          maxAgents: formData.maxAgents,
          maxExperiments: formData.maxExperiments,
          canPublish: formData.canPublish,
          usageUnit: formData.usageUnit,
        },
      });
    };

    const handleCopy = async () => {
      try {
        await navigator.clipboard.writeText(generatedLicense);
        toaster.create({
          title: "License copied to clipboard",
          type: "success",
        });
      } catch {
        toaster.create({
          title: "Failed to copy",
          description: "Please copy the license manually.",
          type: "error",
        });
      }
    };

    const handleReset = () => {
      setFormData(defaultFormData);
      setGeneratedLicense("");
      setUploadedKeyFile(null);
      setPrivateKeyInputMethod("file");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      onGeneratedLicenseChange?.(false);
    };

    const isFormValid =
      formData.privateKey.trim() !== "" &&
      formData.organizationName.trim() !== "" &&
      formData.email.trim() !== "" &&
      formData.expiresAt !== "";

    useEffect(() => {
      onFormStateChange?.({
        isGenerating: generateMutation.isLoading,
        isFormValid,
      });
    }, [generateMutation.isLoading, isFormValid, onFormStateChange]);

    useImperativeHandle(ref, () => ({
      handleGenerate,
      isGenerating: generateMutation.isLoading,
      isFormValid,
      hasGeneratedLicense: !!generatedLicense,
    }));

    if (generatedLicense) {
      const sanitizedName = formData.organizationName.replace(/[\/\\:*?"<>|]/g, "_");
      return (
        <VStack align="start" gap={4} width="full" paddingX={6} paddingY={4}>
          <Box
            backgroundColor="green.50"
            padding={4}
            borderRadius="md"
            width="full"
          >
            <VStack align="start" gap={2}>
              <Text fontSize="sm" fontWeight="medium" color="green.700">
                License generated and downloaded!
              </Text>
              <Text fontSize="sm" color="green.600">
                The license file has been saved as{" "}
                <Text as="span" fontFamily="mono" fontWeight="medium">
                  {sanitizedName}.langwatch-license
                </Text>
              </Text>
            </VStack>
          </Box>
          <HStack>
            <Button
              colorPalette="blue"
              size="sm"
              onClick={() => downloadLicenseFile(generatedLicense, formData.organizationName)}
            >
              Download Again
            </Button>
            <Button variant="outline" size="sm" onClick={handleCopy}>
              Copy to Clipboard
            </Button>
            <Button variant="outline" size="sm" onClick={handleReset}>
              Generate Another
            </Button>
          </HStack>
        </VStack>
      );
    }

    return (
      <VStack align="start" gap={4} width="full" paddingX={6} paddingY={4}>
        <Field.Root width="full">
          <Field.Label fontWeight="medium">Private Key</Field.Label>

          <RadioGroup
            value={privateKeyInputMethod}
            onValueChange={(e) => handlePrivateKeyMethodChange(e.value as PrivateKeyInputMethod)}
            disabled={generateMutation.isLoading}
          >
            <HStack gap={4} marginBottom={3}>
              <Radio value="file">Upload private key file</Radio>
              <Radio value="key">Enter private key</Radio>
            </HStack>
          </RadioGroup>

          {privateKeyInputMethod === "file" && (
            <Box width="full">
              <input
                ref={fileInputRef}
                type="file"
                accept=".pem,.key"
                style={{ display: "none" }}
                onChange={handleFileInputChange}
              />
              {uploadedKeyFile ? (
                <Box
                  borderWidth="1px"
                  borderRadius="lg"
                  padding={4}
                  width="full"
                  backgroundColor="bg.subtle"
                >
                  <HStack justify="space-between" width="full">
                    <HStack gap={3}>
                      <Upload size={20} />
                      <VStack align="start" gap={0}>
                        <Text fontSize="sm" fontWeight="medium">
                          {uploadedKeyFile.name}
                        </Text>
                        <Text fontSize="xs" color="fg.muted">
                          {formatFileSize(uploadedKeyFile.size)}
                        </Text>
                      </VStack>
                    </HStack>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleRemoveKeyFile}
                      disabled={generateMutation.isLoading}
                      aria-label="Remove file"
                    >
                      <X size={16} />
                    </Button>
                  </HStack>
                </Box>
              ) : (
                <Box
                  borderWidth="2px"
                  borderStyle="dashed"
                  borderRadius="lg"
                  padding={6}
                  width="full"
                  cursor="pointer"
                  onClick={handleDropzoneClick}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  borderColor={isDragging ? "blue.500" : "border"}
                  backgroundColor={isDragging ? "blue.50" : "transparent"}
                  transition="all 0.2s"
                  _hover={{ borderColor: "blue.300" }}
                >
                  <VStack gap={2}>
                    <Upload size={24} color="#666" />
                    <Text fontSize="sm" color="fg.muted" textAlign="center">
                      Drop your private key file here
                    </Text>
                    <Text fontSize="xs" color="fg.muted">
                      Click to browse (.pem, .key)
                    </Text>
                  </VStack>
                </Box>
              )}
            </Box>
          )}

          {privateKeyInputMethod === "key" && (
            <Textarea
              value={formData.privateKey}
              onChange={(e) => handleInputChange("privateKey", e.target.value)}
              placeholder="Paste your Private License key"
              fontFamily="mono"
              fontSize="xs"
              rows={6}
              disabled={generateMutation.isLoading}
            />
          )}
        </Field.Root>

        <Field.Root width="full">
          <Field.Label fontWeight="medium">Organization Name</Field.Label>
          <Input
            value={formData.organizationName}
            onChange={(e) => handleInputChange("organizationName", e.target.value)}
            placeholder="Acme Corp"
          />
        </Field.Root>

        <Field.Root width="full">
          <Field.Label fontWeight="medium">Email</Field.Label>
          <Input
            value={formData.email}
            onChange={(e) => handleInputChange("email", e.target.value)}
            placeholder="admin@acme.corp"
            type="email"
          />
        </Field.Root>

        <Field.Root width="full">
          <Field.Label fontWeight="medium">Expiration Date</Field.Label>
          <Input
            value={formData.expiresAt}
            onChange={(e) => handleInputChange("expiresAt", e.target.value)}
            type="date"
          />
        </Field.Root>

        <Field.Root width="full">
          <Field.Label fontWeight="medium">Plan Type</Field.Label>
          <Select.Root
            collection={planTypeCollection}
            value={[formData.planType]}
            onValueChange={(details) => {
              const selected = details.value[0];
              if (selected) handlePlanTypeChange(selected as PlanType);
            }}
          >
            <Select.Trigger width="full">
              <Select.ValueText placeholder="Select plan type" />
            </Select.Trigger>
            <Select.Content paddingY={2} zIndex="popover">
              {planTypeCollection.items.map((item) => (
                <Select.Item key={item.value} item={item}>
                  {item.label}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </Field.Root>

        <Field.Root width="full">
          <Field.Label fontWeight="medium">Usage Unit</Field.Label>
          <Select.Root
            collection={usageUnitCollection}
            value={[formData.usageUnit]}
            onValueChange={(details) => {
              const selected = details.value[0];
              if (selected) handleInputChange("usageUnit", selected);
            }}
          >
            <Select.Trigger width="full">
              <Select.ValueText placeholder="Select usage unit" />
            </Select.Trigger>
            <Select.Content paddingY={2} zIndex="popover">
              {usageUnitCollection.items.map((item) => (
                <Select.Item key={item.value} item={item}>
                  {item.label}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
          <Text fontSize="xs" color="fg.muted" marginTop={1}>
            Determines how usage is counted against the monthly limit.
          </Text>
        </Field.Root>

        <Text fontSize="sm" fontWeight="semibold" marginBottom={2}>
          Plan Limits
        </Text>
        <Box width="full" borderWidth="1px" borderRadius="md" padding={4}>
          <VStack align="start" gap={3}>
            <HStack width="full" gap={4}>
              <NumberField
                label="Max Members"
                value={formData.maxMembers}
                onChange={(value) => handleInputChange("maxMembers", value)}
              />
              <NumberField
                label="Max Lite Members"
                value={formData.maxMembersLite}
                onChange={(value) => handleInputChange("maxMembersLite", value)}
              />
              <NumberField
                label="Max Projects"
                value={formData.maxProjects}
                onChange={(value) => handleInputChange("maxProjects", value)}
              />
            </HStack>

            <HStack width="full" gap={4}>
              <NumberField
                label="Max Messages/Month"
                value={formData.maxMessagesPerMonth}
                onChange={(value) => handleInputChange("maxMessagesPerMonth", value)}
              />
              <NumberField
                label="Evaluations Credit"
                value={formData.evaluationsCredit}
                onChange={(value) => handleInputChange("evaluationsCredit", value)}
              />
              <NumberField
                label="Max Workflows"
                value={formData.maxWorkflows}
                onChange={(value) => handleInputChange("maxWorkflows", value)}
              />
            </HStack>

            <HStack width="full" gap={4}>
              <NumberField
                label="Max Prompts"
                value={formData.maxPrompts}
                onChange={(value) => handleInputChange("maxPrompts", value)}
              />
              <NumberField
                label="Max Evaluators"
                value={formData.maxEvaluators}
                onChange={(value) => handleInputChange("maxEvaluators", value)}
              />
              <NumberField
                label="Max Scenarios"
                value={formData.maxScenarios}
                onChange={(value) => handleInputChange("maxScenarios", value)}
              />
            </HStack>

            <HStack width="full" gap={4}>
              <NumberField
                label="Max Agents"
                value={formData.maxAgents}
                onChange={(value) => handleInputChange("maxAgents", value)}
              />
            </HStack>

            <Checkbox.Root
              checked={formData.canPublish}
              onCheckedChange={(e) => handleInputChange("canPublish", !!e.checked)}
            >
              <Checkbox.HiddenInput />
              <Checkbox.Control />
              <Checkbox.Label fontSize="xs" color="fg.muted">
                Enabled to publish Workflows publicly
              </Checkbox.Label>
            </Checkbox.Root>
          </VStack>
        </Box>
      </VStack>
    );
  }
);
