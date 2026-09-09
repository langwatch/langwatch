/**
 * The jest-dom matchers, registered once for the package.
 *
 * The package has depended on `@testing-library/jest-dom` all along and
 * nothing imported it, so `toBeInTheDocument` was an unknown Chai property and
 * every assertion using it threw rather than failing — four tests that could
 * not pass whatever the component did.
 */
import "@testing-library/jest-dom/vitest";
