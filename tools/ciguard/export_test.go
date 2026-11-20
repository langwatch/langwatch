package ciguard

// WorkflowAndActionFiles exposes the scanned file set to the external tests.
var WorkflowAndActionFiles = workflowAndActionFiles

// IsStoredAWSKeyLine exposes the line check to the external tests.
var IsStoredAWSKeyLine = isStoredAWSKeyLine

// ReleaseLockInputPaths exposes the files the release-lock guard reads to the external tests.
var ReleaseLockInputPaths = releaseLockInputPaths

// ReleaseLockFiles exposes the release-lock guard's file contents to the external tests.
type ReleaseLockFiles = releaseLockFiles

// ReleaseLockProblems exposes the release-lock content check to the external tests.
var ReleaseLockProblems = releaseLockProblems

// ReleaseConfig exposes the release-please config shape to the external tests.
type ReleaseConfig = releaseConfig

// ReleaseExtraFilesProblems exposes the extra-files check to the external tests.
var ReleaseExtraFilesProblems = releaseExtraFilesProblems

// ReleasePackage exposes the release-please package shape to the external tests.
type ReleasePackage = releasePackage

// ReleasePackages exposes the checked release packages to the external tests.
var ReleasePackages = releasePackages
