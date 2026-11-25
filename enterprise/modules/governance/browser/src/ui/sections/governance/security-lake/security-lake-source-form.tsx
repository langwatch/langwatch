// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { Checkbox } from "@langwatch/design-system/checkbox";
import { IdText } from "@langwatch/design-system/id-text";
import {
  Alert,
  Button,
  Field,
  HStack,
  Input,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import type { SecurityLakeConnectionTest } from "@langwatch/enterprise-governance-contract";
import { useEffect, useRef, useState } from "react";

import {
  CLOUDTRAIL_SOURCE_LABELS,
  type SecurityLakeCloudTrailSource,
  type SecurityLakeFormErrors,
  type SecurityLakeFormField,
  type SecurityLakeFormValues,
  securityLakeFormErrors,
} from "../../../../model/security-lake-form-state.ts";

type ConnectionTest = SecurityLakeConnectionTest;

const TEXT_FIELDS: {
  field: SecurityLakeFormField;
  label: string;
  placeholder: string;
  secret?: boolean;
}[] = [
  { field: "name", label: "Name", placeholder: "AWS Security Lake" },
  { field: "region", label: "Region", placeholder: "eu-west-1" },
  {
    field: "subscriberRoleArn",
    label: "Subscriber role ARN",
    placeholder: "arn:aws:iam::123456789012:role/AmazonSecurityLake-subscriber",
  },
  {
    field: "queueUrl",
    label: "SQS queue URL",
    placeholder: "https://sqs.eu-west-1.amazonaws.com/123456789012/subscriber-queue",
  },
  { field: "accessKeyId", label: "Access key id", placeholder: "AKIA..." },
  { field: "secretAccessKey", label: "Secret access key", placeholder: "", secret: true },
];

const ADVANCED_FIELDS: {
  field: "s3Endpoint" | "sqsEndpoint";
  label: string;
  placeholder: string;
}[] = [
  { field: "s3Endpoint", label: "S3 endpoint", placeholder: "https://s3.eu-west-1.amazonaws.com" },
  {
    field: "sqsEndpoint",
    label: "SQS endpoint",
    placeholder: "https://sqs.eu-west-1.amazonaws.com",
  },
];

const WRITE_ONLY: SecurityLakeFormField[] = ["accessKeyId", "secretAccessKey"];

/**
 * The add and edit form of a Security Lake source, with Test connection once it is saved. The
 * external id LangWatch generated shows read-only on a saved source, to copy into the trust policy.
 */
export function SecurityLakeSourceForm({
  initialValues,
  isNew,
  externalId,
  isSaving,
  isTesting,
  testResult,
  onSubmit,
  onTestConnection,
  onCancel,
}: {
  initialValues: SecurityLakeFormValues;
  isNew: boolean;
  externalId?: string;
  isSaving: boolean;
  isTesting?: boolean;
  testResult?: ConnectionTest | null;
  onSubmit: (values: SecurityLakeFormValues) => void;
  onTestConnection?: (values: SecurityLakeFormValues) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState(initialValues);
  const [showAdvanced, setShowAdvanced] = useState(
    Boolean(initialValues.s3Endpoint || initialValues.sqsEndpoint),
  );
  const [errors, setErrors] = useState<SecurityLakeFormErrors>({});
  const set = (field: SecurityLakeFormField, value: string) =>
    setValues((current) => ({ ...current, [field]: value }));
  const toggleSource = (source: SecurityLakeCloudTrailSource, checked: boolean) =>
    setValues((current) => withSource({ values: current, source, checked }));
  const sendOnce = useSendOnce(isSaving);
  /** Shows the form's errors and says whether the values may be sent. */
  const validate = () => {
    const found = securityLakeFormErrors({ values, isNew });
    setErrors(found);
    if (found.s3Endpoint || found.sqsEndpoint) setShowAdvanced(true);
    return Object.keys(found).length === 0;
  };
  const submit = () => {
    if (!sendOnce.canSend() || !validate()) return;
    sendOnce.sent();
    onSubmit(values);
  };
  const testConnection = () => {
    if (onTestConnection && validate()) onTestConnection(values);
  };

  return (
    <VStack
      align="stretch"
      gap={4}
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {TEXT_FIELDS.map(({ field, label, placeholder, secret }) => (
        <Field.Root key={field} invalid={Boolean(errors[field])}>
          <Field.Label>{label}</Field.Label>
          <Input
            aria-label={label}
            type={secret ? "password" : "text"}
            value={values[field] as string}
            placeholder={
              !isNew && WRITE_ONLY.includes(field) ? "Stored, leave blank to keep" : placeholder
            }
            onChange={(event) => set(field, event.target.value)}
          />
          {errors[field] && <Field.ErrorText>{errors[field]}</Field.ErrorText>}
        </Field.Root>
      ))}
      {!isNew && externalId && <GeneratedExternalId externalId={externalId} />}
      <Field.Root invalid={Boolean(errors.sources)}>
        <Field.Label>Sources</Field.Label>
        <VStack align="start" gap={2}>
          {(Object.keys(CLOUDTRAIL_SOURCE_LABELS) as SecurityLakeCloudTrailSource[]).map(
            (source) => (
              <Checkbox
                key={source}
                checked={values.sources.includes(source)}
                inputProps={{ "aria-label": CLOUDTRAIL_SOURCE_LABELS[source] }}
                onCheckedChange={({ checked }) => toggleSource(source, checked === true)}
              >
                {CLOUDTRAIL_SOURCE_LABELS[source]}
              </Checkbox>
            ),
          )}
        </VStack>
        {errors.sources && <Field.ErrorText>{errors.sources}</Field.ErrorText>}
      </Field.Root>
      <Button
        variant="ghost"
        size="sm"
        alignSelf="start"
        aria-expanded={showAdvanced}
        onClick={() => setShowAdvanced((open) => !open)}
      >
        {showAdvanced ? "Hide advanced" : "Advanced"}
      </Button>
      {showAdvanced && (
        <VStack align="stretch" gap={4}>
          <Text textStyle="xs" color="fg.muted">
            Leave blank to use the AWS endpoints of the Region, for example behind a VPC endpoint.
          </Text>
          {ADVANCED_FIELDS.map(({ field, label, placeholder }) => (
            <Field.Root key={field} invalid={Boolean(errors[field])}>
              <Field.Label>{label}</Field.Label>
              <Input
                aria-label={label}
                value={values[field]}
                placeholder={placeholder}
                onChange={(event) => set(field, event.target.value)}
              />
              {errors[field] && <Field.ErrorText>{errors[field]}</Field.ErrorText>}
            </Field.Root>
          ))}
        </VStack>
      )}
      {testResult && <ConnectionTestResult result={testResult} />}
      <HStack justify="end" gap={2}>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        {!isNew && onTestConnection && (
          <Button variant="outline" loading={isTesting} onClick={testConnection}>
            Test connection
          </Button>
        )}
        <Button type="submit" colorPalette="orange" loading={isSaving}>
          {isNew ? "Add source" : "Save"}
        </Button>
      </HStack>
      {isNew && (
        <Text textStyle="xs" color="fg.muted">
          Save the source to test the connection.
        </Text>
      )}
    </VStack>
  );
}

function withSource({
  values,
  source,
  checked,
}: {
  values: SecurityLakeFormValues;
  source: SecurityLakeCloudTrailSource;
  checked: boolean;
}): SecurityLakeFormValues {
  const rest = values.sources.filter((item) => item !== source);
  return { ...values, sources: checked ? [...rest, source] : rest };
}

/** Holds a sent save until the parent's pending save ends, so a second Enter sends nothing. */
function useSendOnce(isSaving: boolean) {
  const sending = useRef(false);
  const wasSaving = useRef(isSaving);
  useEffect(() => {
    if (wasSaving.current && !isSaving) sending.current = false;
    wasSaving.current = isSaving;
  }, [isSaving]);
  return {
    canSend: () => !isSaving && !sending.current,
    sent: () => {
      sending.current = true;
    },
  };
}

function GeneratedExternalId({ externalId }: { externalId: string }) {
  return (
    <Field.Root>
      <Field.Label>External id</Field.Label>
      <IdText value={externalId} label="external id" />
      <Field.HelperText>
        Generated by LangWatch. The subscriber role&apos;s trust policy must require it as the
        sts:ExternalId condition.
      </Field.HelperText>
    </Field.Root>
  );
}

function ConnectionTestResult({ result }: { result: ConnectionTest }) {
  if (!result.ok) {
    return (
      <Alert.Root status="error">
        <Alert.Indicator />
        <Alert.Title>Queue unreachable: {result.error ?? "unknown error"}</Alert.Title>
      </Alert.Root>
    );
  }
  return (
    <Alert.Root status="success">
      <Alert.Indicator />
      <Alert.Title>
        Queue reachable: {result.waiting ?? 0} waiting, {result.inFlight ?? 0} in flight
      </Alert.Title>
    </Alert.Root>
  );
}
