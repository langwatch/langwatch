/** Generated from modules/catalogue.json. Do not edit by hand. */
/** Run `pnpm generate:modules` to rewrite it. */

import { annotationWeb } from "@langwatch/annotation-browser/declaration";
import { authzWeb } from "@langwatch/authz-browser/declaration";
import { automationWeb } from "@langwatch/automation-browser/declaration";
import { dataPrivacyWeb } from "@langwatch/data-privacy-browser/declaration";
import { dataRetentionWeb } from "@langwatch/data-retention-browser/declaration";
import { datasetWeb } from "@langwatch/dataset-browser/declaration";
import { githubWeb } from "@langwatch/github-browser/declaration";
import { monitorWeb } from "@langwatch/monitor-browser/declaration";
import { notificationWeb } from "@langwatch/notification-browser/declaration";
import { projectWeb } from "@langwatch/project-browser/declaration";
import { promptWeb } from "@langwatch/prompt-browser/declaration";
import { secretWeb } from "@langwatch/secret-browser/declaration";
import { topicWeb } from "@langwatch/topic-browser/declaration";

/** Every installed module's web declaration, in name order. */
export const webModules = [
  annotationWeb satisfies { readonly name: "annotation" },
  authzWeb satisfies { readonly name: "authz" },
  automationWeb satisfies { readonly name: "automation" },
  dataPrivacyWeb satisfies { readonly name: "data-privacy" },
  dataRetentionWeb satisfies { readonly name: "data-retention" },
  datasetWeb satisfies { readonly name: "dataset" },
  githubWeb satisfies { readonly name: "github" },
  monitorWeb satisfies { readonly name: "monitor" },
  notificationWeb satisfies { readonly name: "notification" },
  projectWeb satisfies { readonly name: "project" },
  promptWeb satisfies { readonly name: "prompt" },
  secretWeb satisfies { readonly name: "secret" },
  topicWeb satisfies { readonly name: "topic" },
] as const;
import type { serverModules } from "./server-modules.generated";
export const webModulePackages = {} as const;
type PairedOnDisk = never;
type MissingWeb = Exclude<PairedOnDisk, (typeof webModules)[number]["name"]>;
type MissingServer = Exclude<PairedOnDisk, (typeof serverModules)[number]["name"]>;
export const webModulePairing = {} satisfies {
  [Id in `missing web half "${MissingWeb}"` | `missing server half "${MissingServer}"`]: never;
};
