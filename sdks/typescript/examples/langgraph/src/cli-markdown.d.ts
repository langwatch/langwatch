declare module 'cli-markdown' {
  export interface CliMarkdownOptions {
    /**
     * Custom styles for different markdown elements
     */
    styles?: {
      /**
       * Style for headings (h1, h2, h3, etc.)
       */
      heading?: string;
      /**
       * Style for bold text
       */
      bold?: string;
      /**
       * Style for italic text
       */
      italic?: string;
      /**
       * Style for code blocks
       */
      code?: string;
      /**
       * Style for inline code
       */
      inlineCode?: string;
      /**
       * Style for links
       */
      link?: string;
      /**
       * Style for lists
       */
      list?: string;
      /**
       * Style for blockquotes
       */
      blockquote?: string;
      /**
       * Style for horizontal rules
       */
      hr?: string;
    };
    /**
     * Whether to preserve line breaks
     */
    preserveLineBreaks?: boolean;
    /**
     * Custom renderer functions for different markdown elements
     */
    renderers?: {
      /**
       * Custom renderer for headings
       */
      heading?: (text: string, level: number) => string;
      /**
       * Custom renderer for paragraphs
       */
      paragraph?: (text: string) => string;
      /**
       * Custom renderer for lists
       */
      list?: (items: string[], ordered: boolean) => string;
      /**
       * Custom renderer for list items
       */
      listItem?: (text: string, index: number) => string;
      /**
       * Custom renderer for code blocks
       */
      code?: (code: string, language?: string) => string;
      /**
       * Custom renderer for inline code
       */
      inlineCode?: (code: string) => string;
      /**
       * Custom renderer for links
       */
      link?: (text: string, url: string) => string;
      /**
       * Custom renderer for images
       */
      image?: (alt: string, url: string) => string;
      /**
       * Custom renderer for blockquotes
       */
      blockquote?: (text: string) => string;
      /**
       * Custom renderer for horizontal rules
       */
      hr?: () => string;
      /**
       * Custom renderer for emphasis (bold/italic)
       */
      emphasis?: (text: string, type: 'bold' | 'italic') => string;
    };
    /**
     * Maximum width for text wrapping
     */
    maxWidth?: number;
    /**
     * Whether to enable ANSI color codes
     */
    colors?: boolean;
    /**
     * Custom color theme
     */
    theme?: {
      /**
       * Color for headings
       */
      heading?: string;
      /**
       * Color for links
       */
      link?: string;
      /**
       * Color for code
       */
      code?: string;
      /**
       * Color for blockquotes
       */
      blockquote?: string;
    };
  }

  /**
   * Converts markdown text to formatted CLI output
   * @param markdown - The markdown text to convert
   * @param options - Configuration options for the conversion
   * @returns Formatted CLI text
   */
  function cliMarkdown(markdown: string, options?: CliMarkdownOptions): string;

  export = cliMarkdown;
}
