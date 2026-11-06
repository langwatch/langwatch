import { Link } from "@langwatch/browser-host/link";
import { Card } from "@langwatch/design-system/card";
import {
  Box,
  Button,
  Field,
  HStack,
  Input,
  Text,
  Textarea,
  VStack,
} from "@langwatch/design-system/primitives";
import { SegmentedControl } from "@langwatch/design-system/segmented-control";
import { StatusChip } from "@langwatch/design-system/settings-card";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { CONTACT_SALES_URL } from "@langwatch/enterprise-licensing-contract";
import { ArrowUpRight, KeyRound, Upload, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { formatFileSize, licenseTextOfFile } from "../../model/license-status.ts";
import { useLicensingHost } from "../../model/licensing-host.ts";

type ActivationMethod = "code" | "file" | "key";

interface NoLicenseCardProps {
  licenseKey: string;
  onLicenseKeyChange: (value: string) => void;
  onActivate: () => void;
  onFileActivate?: (fileContent: string) => void;
  activationCode: string;
  onActivationCodeChange: (value: string) => void;
  onCodeActivate: () => void;
  isActivating: boolean;
  /** Whether the viewer may manage the organization; without it the card only informs. */
  canManage: boolean;
  /** `replace` enters a new license over the installed one, in one step. */
  mode?: "install" | "replace";
  /** Closes the replace form without changing anything. */
  onCancel?: () => void;
}

/** Why a chosen file was not taken, in the words the operator can act on. */
const NOT_A_LICENSE_FILE =
  "This file does not contain a LangWatch license. Choose the license file from your order email, or paste the key instead.";
const UNREADABLE_FILE = "This file could not be read. Choose it again, or paste the key instead.";

export function NoLicenseCard({
  licenseKey,
  onLicenseKeyChange,
  onActivate,
  onFileActivate,
  activationCode,
  onActivationCodeChange,
  onCodeActivate,
  isActivating,
  canManage,
  mode = "install",
  onCancel,
}: NoLicenseCardProps) {
  const host = useLicensingHost();
  const purchaseLinkUrl = host.licensePurchaseUrl();

  const [activationMethod, setActivationMethod] = useState<ActivationMethod>("code");
  const [uploadedFile, setUploadedFile] = useState<ChosenLicenseFile | null>(null);
  const handleMethodChange = (method: ActivationMethod) => {
    setActivationMethod(method);
  };

  const handleActivate = useCallback(() => {
    const activations: Record<ActivationMethod, () => void> = {
      code: onCodeActivate,
      key: onActivate,
      file: () => {
        if (uploadedFile && onFileActivate) onFileActivate(uploadedFile.licenseText);
      },
    };
    activations[activationMethod]();
  }, [activationMethod, uploadedFile, onFileActivate, onActivate, onCodeActivate]);

  const hasInput: Record<ActivationMethod, boolean> = {
    code: activationCode.trim().length > 0,
    file: uploadedFile !== null,
    key: licenseKey.trim().length > 0,
  };
  const isActivateDisabled = isActivating || !hasInput[activationMethod];
  const isReplacing = mode === "replace";

  if (!canManage) {
    return (
      <Card
        title="No license installed"
        description="Running without a license. Some features may be limited."
        status="neutral"
        icon={<KeyRound size={16} />}
        badge={<StatusChip label="Open source" tone="neutral" />}
      >
        <Text fontSize="sm" color="fg.muted" data-testid="license-admin-only">
          An organization admin can activate a license.
        </Text>
      </Card>
    );
  }

  return (
    <Card
      title={isReplacing ? "Replace license" : "No license installed"}
      description={
        isReplacing
          ? "Enter the renewed or reissued license. It takes the place of the current one in one step, so the organization keeps its license throughout."
          : "Running without a license. Some features may be limited."
      }
      status="neutral"
      icon={<KeyRound size={16} />}
      badge={isReplacing ? void 0 : <StatusChip label="Open source" tone="neutral" />}
      footer={
        <ActivationFooter
          isReplacing={isReplacing}
          onActivate={handleActivate}
          onCancel={onCancel}
          isActivating={isActivating}
          isActivateDisabled={isActivateDisabled}
          purchaseLinkUrl={purchaseLinkUrl}
        />
      }
    >
      <VStack align="stretch" gap={2}>
        <VStack align="start" gap={3} width="full">
          <SegmentedControl
            size="sm"
            value={activationMethod}
            onValueChange={(e) => handleMethodChange(e.value as ActivationMethod)}
            disabled={isActivating}
            items={[
              { value: "code", label: "Activation code" },
              { value: "file", label: "License file" },
              { value: "key", label: "License key" },
            ]}
          />

          {activationMethod === "file" && (
            <LicenseFileField
              uploadedFile={uploadedFile}
              onChosen={setUploadedFile}
              isActivating={isActivating}
            />
          )}

          {activationMethod === "code" && (
            <Field.Root width="full">
              <Field.Label srOnly>Activation code</Field.Label>
              <Input
                value={activationCode}
                onChange={(e) => onActivationCodeChange(e.target.value)}
                placeholder="LW-XXXX-XXXX-XXXX-XXXX"
                data-testid="license-activation-code"
                fontFamily="mono"
                maxWidth="360px"
                disabled={isActivating}
              />
              <Field.HelperText>
                Your code was sent with your order. This install asks LangWatch for the license it
                covers, so it needs to reach the internet. If it cannot, upload the license file
                instead.
              </Field.HelperText>
            </Field.Root>
          )}

          {activationMethod === "key" && (
            <Field.Root width="full">
              <Field.Label srOnly>License key</Field.Label>
              <Textarea
                value={licenseKey}
                onChange={(e) => onLicenseKeyChange(e.target.value)}
                placeholder="Paste your license key"
                data-testid="license-key-input"
                rows={4}
                fontFamily="mono"
                fontSize="xs"
                disabled={isActivating}
              />
            </Field.Root>
          )}
        </VStack>
      </VStack>
    </Card>
  );
}

type ChosenLicenseFile = { file: File; licenseText: string };

function ActivationFooter({
  isReplacing,
  onActivate,
  onCancel,
  isActivating,
  isActivateDisabled,
  purchaseLinkUrl,
}: {
  isReplacing: boolean;
  onActivate: () => void;
  onCancel?: () => void;
  isActivating: boolean;
  isActivateDisabled: boolean;
  purchaseLinkUrl: string | undefined;
}) {
  return (
    <>
      <Button
        variant="outline"
        colorPalette="orange"
        size="sm"
        onClick={onActivate}
        data-testid={isReplacing ? "license-replace-submit" : "license-activate"}
        loading={isActivating}
        disabled={isActivateDisabled}
      >
        {isReplacing ? "Replace license" : "Activate license"}
      </Button>
      {isReplacing && onCancel ? (
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={isActivating}>
          Cancel
        </Button>
      ) : null}
      {!isReplacing && purchaseLinkUrl && (
        <Tooltip content="After purchase, your license will be generated and delivered to your email.">
          <Button asChild variant="outline" size="sm">
            <Link href={purchaseLinkUrl} isExternal>
              Purchase license
              <ArrowUpRight size={14} />
            </Link>
          </Button>
        </Tooltip>
      )}
      {!isReplacing && (
        <Link
          href={CONTACT_SALES_URL}
          isExternal
          color="orange.fg"
          fontSize="sm"
          _hover={{ textDecoration: "underline" }}
        >
          Contact sales →
        </Link>
      )}
    </>
  );
}

/** The dropzone: a file is judged by its content, so a mail client may have renamed it. */
function LicenseFileField({
  uploadedFile,
  onChosen,
  isActivating,
}: {
  uploadedFile: ChosenLicenseFile | null;
  onChosen: (chosen: ChosenLicenseFile | null) => void;
  isActivating: boolean;
}) {
  const [fileError, setFileError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Each selection takes a number; a read finishing after a newer selection, a removal or
  // unmount is dropped.
  const selection = useRef(0);
  useEffect(
    () => () => {
      selection.current += 1;
    },
    [],
  );

  const handleFileSelect = (file: File) => {
    const current = ++selection.current;
    setFileError(null);
    onChosen(null);
    void file.text().then(
      (text) => {
        if (current !== selection.current) return;
        const licenseText = licenseTextOfFile({ text, size: file.size });
        if (licenseText === null) setFileError(NOT_A_LICENSE_FILE);
        else onChosen({ file, licenseText });
      },
      () => {
        if (current === selection.current) setFileError(UNREADABLE_FILE);
      },
    );
  };

  const handleRemoveFile = () => {
    selection.current += 1;
    onChosen(null);
    setFileError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <Box width="full">
      <input
        ref={fileInputRef}
        type="file"
        data-testid="license-file-input"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFileSelect(file);
        }}
      />
      {uploadedFile ? (
        <Card variant="nested">
          <HStack justify="space-between" width="full">
            <HStack gap={3}>
              <Upload size={20} />
              <VStack align="start" gap={0}>
                <Text fontSize="sm" fontWeight="medium">
                  {uploadedFile.file.name}
                </Text>
                <Text fontSize="xs" color="fg.muted">
                  {formatFileSize(uploadedFile.file.size)}
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
        </Card>
      ) : (
        <Box
          borderWidth="2px"
          borderStyle="dashed"
          borderRadius="lg"
          padding={6}
          width="full"
          cursor="pointer"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            const file = e.dataTransfer.files[0];
            if (file) handleFileSelect(file);
          }}
          borderColor={isDragging ? "orange.emphasized" : "border"}
          backgroundColor={isDragging ? "orange.subtle" : "transparent"}
          transition="all 0.2s"
          _hover={{ borderColor: "orange.emphasized" }}
        >
          <VStack gap={2}>
            <Box color="fg.muted">
              <Upload size={24} />
            </Box>
            <Text fontSize="sm" color="fg.muted" textAlign="center">
              Drop your license here
            </Text>
            <Text fontSize="xs" color="fg.muted">
              Click to browse
            </Text>
          </VStack>
        </Box>
      )}
      {fileError ? (
        <Text fontSize="sm" color="red.fg" marginTop={2} data-testid="license-file-error">
          {fileError}
        </Text>
      ) : null}
    </Box>
  );
}
