export interface ParsedFrontmatter {
    frontmatter: Record<string, string>;
    body: string;
}
export declare function splitFrontmatter(raw: string): ParsedFrontmatter;
