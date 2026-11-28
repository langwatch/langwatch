// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  SECURITY_LAKE_CLOUDTRAIL_SOURCES,
  securityLakePullConfigSchema,
} from "@langwatch/enterprise-governance-contract";

export type SecurityLakeCloudTrailSource = (typeof SECURITY_LAKE_CLOUDTRAIL_SOURCES)[number];

export const CLOUDTRAIL_SOURCE_LABELS: Record<SecurityLakeCloudTrailSource, string> = {
  CLOUD_TRAIL_MGMT: "CloudTrail management events",
  S3_DATA: "CloudTrail S3 data events",
  LAMBDA_EXECUTION: "CloudTrail Lambda data events",
};

export interface SecurityLakeFormValues {
  name: string;
  region: string;
  subscriberRoleArn: string;
  queueUrl: string;
  sources: SecurityLakeCloudTrailSource[];
  accessKeyId: string;
  secretAccessKey: string;
  s3Endpoint: string;
  sqsEndpoint: string;
}

export type SecurityLakeFormField = keyof SecurityLakeFormValues;
export type SecurityLakeFormErrors = Partial<Record<SecurityLakeFormField, string>>;

/** A new source reads every CloudTrail source the lake offers, management and data events. */
export function blankSecurityLakeForm(): SecurityLakeFormValues {
  return {
    name: "AWS Security Lake",
    region: "",
    subscriberRoleArn: "",
    queueUrl: "",
    sources: [...SECURITY_LAKE_CLOUDTRAIL_SOURCES],
    accessKeyId: "",
    secretAccessKey: "",
    s3Endpoint: "",
    sqsEndpoint: "",
  };
}

/** The stored settings of a saved source; the keys are write-only and open blank. */
export function securityLakeFormFromSource({
  name,
  parserConfig,
}: {
  name: string;
  parserConfig?: Record<string, unknown> | null;
}): SecurityLakeFormValues {
  const parsed = securityLakePullConfigSchema.partial().safeParse(parserConfig ?? {});
  const config = parsed.success ? parsed.data : {};
  return {
    ...blankSecurityLakeForm(),
    name,
    region: config.region ?? "",
    subscriberRoleArn: config.subscriberRoleArn ?? "",
    queueUrl: config.queueUrl ?? "",
    sources: config.sources ?? [...SECURITY_LAKE_CLOUDTRAIL_SOURCES],
    s3Endpoint: config.s3Endpoint ?? "",
    sqsEndpoint: config.sqsEndpoint ?? "",
  };
}

const CONFIG_FIELDS = ["region", "subscriberRoleArn", "queueUrl", "sources"] as const;
const ENDPOINT_FIELDS = ["s3Endpoint", "sqsEndpoint"] as const;

/** The endpoint overrides that are set; a blank one reads the AWS default for the Region. */
function endpointOverrides(values: SecurityLakeFormValues) {
  return {
    ...(values.s3Endpoint ? { s3Endpoint: values.s3Endpoint } : {}),
    ...(values.sqsEndpoint ? { sqsEndpoint: values.sqsEndpoint } : {}),
  };
}

function configFieldErrors(values: SecurityLakeFormValues): SecurityLakeFormErrors {
  const errors: SecurityLakeFormErrors = {};
  const shape = securityLakePullConfigSchema.shape;
  for (const field of CONFIG_FIELDS) {
    const result = shape[field].safeParse(values[field]);
    if (!result.success) errors[field] = result.error.issues[0]?.message ?? "Invalid value";
  }
  return errors;
}

function endpointErrors(values: SecurityLakeFormValues): SecurityLakeFormErrors {
  const errors: SecurityLakeFormErrors = {};
  for (const field of ENDPOINT_FIELDS) {
    if (!values[field]) continue;
    const schema = securityLakePullConfigSchema.shape[field];
    const isUrl = schema.validate(values[field]);
    if (!isUrl) {
      errors[field] = "Enter a full URL such as https://s3.eu-west-1.amazonaws.com";
    }
  }
  return errors;
}

/** Checks the values against the contract. A new source needs keys; an edit keeps blank keys. */
export function securityLakeFormErrors({
  values,
  isNew,
}: {
  values: SecurityLakeFormValues;
  isNew: boolean;
}): SecurityLakeFormErrors {
  const errors: SecurityLakeFormErrors = {};
  if (!values.name.trim()) errors.name = "Name the source";
  Object.assign(errors, configFieldErrors(values), endpointErrors(values));
  if (values.sources.length === 0) errors.sources = "Pick at least one CloudTrail source";
  const hasKeys = values.accessKeyId !== "" || values.secretAccessKey !== "";
  if (isNew || hasKeys) {
    if (!values.accessKeyId) errors.accessKeyId = "Enter the access key id";
    if (!values.secretAccessKey) errors.secretAccessKey = "Enter the secret access key";
  }
  return errors;
}

/** The create input the `securityLakeCreate` mutation takes. */
export function securityLakeCreateInput(values: SecurityLakeFormValues) {
  return {
    name: values.name.trim(),
    config: {
      region: values.region,
      subscriberRoleArn: values.subscriberRoleArn,
      queueUrl: values.queueUrl,
      sources: values.sources,
      ...endpointOverrides(values),
    },
    credentials: {
      aws_access_key_id: values.accessKeyId,
      aws_secret_access_key: values.secretAccessKey,
    },
  };
}

/**
 * The update input: blank write-only fields are left out so the stored ones stay, and a blank
 * endpoint is sent as null so the stored override is removed.
 */
export function securityLakeUpdateInput(values: SecurityLakeFormValues) {
  return {
    name: values.name.trim(),
    config: {
      region: values.region,
      subscriberRoleArn: values.subscriberRoleArn,
      queueUrl: values.queueUrl,
      sources: values.sources,
      s3Endpoint: values.s3Endpoint || null,
      sqsEndpoint: values.sqsEndpoint || null,
    },
    ...(values.accessKeyId
      ? {
          credentials: {
            aws_access_key_id: values.accessKeyId,
            aws_secret_access_key: values.secretAccessKey,
          },
        }
      : {}),
  };
}

/** What Test connection sends: the form's settings, and its keys when typed (blank keeps saved). */
export function securityLakeTestInput(values: SecurityLakeFormValues) {
  const { name: _name, ...input } = securityLakeUpdateInput(values);
  return input;
}
