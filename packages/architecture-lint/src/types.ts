export type FeaturePackageRole = "contract" | "server" | "web";

export type FeatureLayoutVersion = 0;

export type PackageKind =
  | FeaturePackageRole
  | "config"
  | "design-system"
  | "tooling";

export type PackageManifest = {
  name?: string;
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
