import { useCallback, useRef, useState } from "react";
import {
  Box,
  Button,
  Field,
  HStack,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { Upload, X } from "lucide-react";
import { Link } from "~/components/ui/link";
import { Radio, RadioGroup } from "~/components/ui/radio";
import { Tooltip } from "~/components/ui/tooltip";
import { formatFileSize } from "./licenseStatusUtils";
import { CONTACT_SALES_URL } from "../plans/constants";

type ActivationMethod = "file" | "key";

interface NoLicenseCardProps {
  licenseKey: string;
  onLicenseKeyChange: (value: string) => void;
  onActivate: () => void;
  onFileActivate?: (fileContent: string) => void;
  isActivating: boolean;
}

export function NoLicenseCard({
  licenseKey,
  onLicenseKeyChange,
  onActivate,
  onFileActivate,
  isActivating,
}: NoLicenseCardProps) {
  const [activationMethod, setActivationMethod] =
    useState<ActivationMethod>("file");
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleMethodChange = (method: ActivationMethod) => {
    setActivationMethod(method);
  };

  const handleFileSelect = useCallback((file: File) => {
    if (!file.name.endsWith(".langwatch-license")) {
      return;
    }
    setUploadedFile(file);
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
      if (file) handleFileSelect(file);
    },
    [handleFileSelect],
  );

  const handleDropzoneClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFileSelect(file);
    },
    [handleFileSelect],
  );

  const handleRemoveFile = useCallback(() => {
    setUploadedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  const handleActivate = useCallback(() => {
    if (activationMethod === "file" && uploadedFile) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        if (onFileActivate) {
          onFileActivate(content);
        }
      };
      reader.readAsText(uploadedFile);
    } else if (activationMethod === "key") {
      onActivate();
    }
  }, [activationMethod, uploadedFile, onFileActivate, onActivate]);

  const isActivateDisabled =
    isActivating ||
    (activationMethod === "file" && !uploadedFile) ||
    (activationMethod === "key" && !licenseKey.trim());

  return (
    <Box borderWidth="1px" borderRadius="lg" padding={6} width="full">
      <VStack align="start" gap={4}>
        <VStack align="start" gap={1}>
          <Text fontWeight="medium" fontSize="md">
            No license installed
          </Text>
          <Text color="fg.muted" fontSize="sm">
            Running without a license. Some features may be limited.
          </Text>
        </VStack>

        <VStack align="start" gap={3} width="full">
          <Text fontWeight="medium">Activate a license:</Text>

          <RadioGroup
            value={activationMethod}
            onValueChange={(e) =>
              handleMethodChange(e.value as ActivationMethod)
            }
            disabled={isActivating}
          >
            <HStack gap={4}>
              <Radio value="file">Upload license file</Radio>
              <Radio value="key">Enter license key</Radio>
            </HStack>
          </RadioGroup>

          {activationMethod === "file" && (
            <Box width="full">
              <input
                ref={fileInputRef}
                type="file"
                accept=".langwatch-license"
                style={{ display: "none" }}
                onChange={handleFileInputChange}
              />
              {uploadedFile ? (
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
                          {uploadedFile.name}
                        </Text>
                        <Text fontSize="xs" color="fg.muted">
                          {formatFileSize(uploadedFile.size)}
                        </Text>
                      </VStack>
                    </HStack>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleRemoveFile}
                      disabled={isActivating}
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
                      Drop your license here
                    </Text>
                    <Text fontSize="xs" color="fg.muted">
                      Click to browse
                    </Text>
                  </VStack>
                </Box>
              )}
            </Box>
          )}

          {activationMethod === "key" && (
            <Field.Root width="full">
              <Field.Label srOnly>License key</Field.Label>
              <Textarea
                value={licenseKey}
                onChange={(e) => onLicenseKeyChange(e.target.value)}
                placeholder="Paste your license key"
                rows={4}
                fontFamily="mono"
                fontSize="xs"
                disabled={isActivating}
              />
            </Field.Root>
          )}

          <HStack gap={3}>
            <Button
              colorPalette="blue"
              variant="solid"
              size="sm"
              onClick={handleActivate}
              loading={isActivating}
              disabled={isActivateDisabled}
            >
              Activate License
            </Button>
            <Tooltip content="After purchase, your license will be generated and delivered to your email.">
              <Button asChild variant="outline" size="sm">
                <Link
                  href="https://buy.stripe.com/dRm3cwaIDgXs6yK6sX0480f"
                  isExternal
                >
                  Purchase license
                </Link>
              </Button>
            </Tooltip>
            <Link
              href={CONTACT_SALES_URL}
              isExternal
              color="blue.fg"
              fontSize="sm"
              _hover={{ textDecoration: "underline" }}
            >
              Contact sales
            </Link>
          </HStack>
        </VStack>
      </VStack>
    </Box>
  );
}
