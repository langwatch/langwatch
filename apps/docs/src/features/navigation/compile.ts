export { pageLastModified } from "./compile/last-modified.ts";
export { docsNavPlugin } from "./compile/nav-plugin.ts";
export { buildNav, openapiPages, pageDates, readDocsConfig, type DocsItem } from "./compile/nav.ts";
export { docsPagesPlugin } from "./compile/pages-plugin.ts";
export {
  isStaticRedirect,
  readBuiltRedirects,
  redirectPage,
  redirectTarget,
  resolveRedirect,
  siteRedirects,
  type Redirects,
} from "./compile/redirects.ts";
