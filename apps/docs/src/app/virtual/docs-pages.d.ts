import type { PageModule } from "../pages.ts";

declare const pages: Record<string, () => Promise<PageModule>>;
export default pages;
