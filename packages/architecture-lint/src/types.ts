export type FeaturePackageRole = "contract" | "server" | "web";

export type ApplicationPackageRole = "ui" | "api" | "worker" | "server";

export type EnterpriseCompositionRole = "api" | "worker" | "web";

export type FeatureLayoutVersion = 0;

export type PackageKind =
  | FeaturePackageRole
  | "application"
  | "dev-runtime"
  | "enterprise-root"
  | "enterprise-composition"
  | "config"
  | "design-system"
  | "tooling";

export type PackageManifest = {
  name?: string;
  private?: boolean;
  license?: string;
  exports?: unknown;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

export type ClassifiedPackage = {
  name: string;
  root: string;
  manifestPath: string;
  manifest: PackageManifest;
  kind: PackageKind;
  applicationRole?: ApplicationPackageRole;
  enterpriseCompositionRole?: EnterpriseCompositionRole;
  feature?: string;
  featureRoot?: string;
  layoutVersion?: FeatureLayoutVersion;
  enterprise: boolean;
};

export type ArchitectureViolation = {
  policy: string;
  file: string;
  line?: number;
  specifier?: string;
  message: string;
  allowed?: string;
};

export type LintWorkspaceOptions = {
  root: string;
  declarations?: boolean;
};
