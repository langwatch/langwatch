// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Where a person on Cloud finds one self-hosted instance. */

/** Cloud admin's self-hosted instances page, its drawer open on one row where it is known. */
export function selfHostedInstanceAdminUrl({
  baseUrl,
  instanceRowId,
}: {
  baseUrl: string;
  instanceRowId: string | null;
}): string {
  const page = `${baseUrl.replace(/\/+$/, "")}/ops/cloud/self-hosted-instances`;
  return instanceRowId ? `${page}?instance=${encodeURIComponent(instanceRowId)}` : page;
}
