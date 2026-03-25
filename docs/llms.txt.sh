#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Read the configuration from llms.txt.json
const config = JSON.parse(fs.readFileSync('llms.txt.json', 'utf8'));
const includePaths = config.includePaths;
const excludePaths = config.excludePaths || [];

// Read docs.json for navigation structure
const docsConfig = JSON.parse(fs.readFileSync('docs.json', 'utf8'));

// Output files
const outputFile = 'llms-full.txt';
const rootOutputFile = 'llms.txt';

// Clear the output file if it exists
fs.writeFileSync(outputFile, "# LangWatch\n\n");

// Function to extract frontmatter from MDX files
function extractFrontmatter(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      console.warn(`Warning: File not found: ${filePath}`);
      return { title: null, description: null };
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);

    if (!frontmatterMatch) {
      return { title: null, description: null };
    }

    const frontmatter = frontmatterMatch[1];
    const titleMatch = frontmatter.match(/^title:\s*(.*)$/m);
    const descriptionMatch = frontmatter.match(/^description:\s*(.*)$/m);

    return {
      title: titleMatch ? titleMatch[1].replace(/^["']|["']$/g, '') : null,
      description: descriptionMatch ? descriptionMatch[1].replace(/^["']|["']$/g, '') : null
    };
  } catch (err) {
    console.error(`Error reading frontmatter from ${filePath}: ${err.message}`);
    return { title: null, description: null };
  }
}

// Function to generate title from filename
function generateTitleFromFilename(filename) {
  return filename
    .replace(/\.mdx?$/, '')
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// Function to process navigation pages recursively
function processNavigationPages(pages, level = 0, output = []) {
  const prefix = '#'.repeat(Math.min(3 + level, 6)); // Start at ### and go up to ######

  pages.forEach((page, index) => {
    const isLastItem = index === pages.length - 1;
    const nextItem = pages[index + 1];
    const isNextItemGroup = nextItem && typeof nextItem === 'object' && nextItem.group;

    if (typeof page === 'string') {
      // It's a direct page reference
      const cleanPage = page.startsWith('/') ? page.substring(1) : page;
      const filePath = `${cleanPage}.mdx`;
      const { title, description } = extractFrontmatter(filePath);
      const displayTitle = title || generateTitleFromFilename(path.basename(cleanPage));
      const url = `https://langwatch.ai/docs/${cleanPage}.md`;

      if (description) {
        output.push(`- [${displayTitle}](${url}): ${description}`);
      } else {
        output.push(`- [${displayTitle}](${url})`);
      }

      // Add spacing after page if next item is a group
      if (isNextItemGroup) {
        output.push('');
      }
    } else if (page.group && page.pages) {
      // It's a group with nested pages
      output.push(`${prefix} ${page.group}`);
      output.push(''); // Add empty line after group title
      processNavigationPages(page.pages, level + 1, output);

      // Add spacing after group if not the last item
      if (!isLastItem) {
        output.push('');
      }
    }
  });

  return output;
}

// Function to generate root llms.txt
function generateRootLlmsTxt() {
  // Get all anchors that have groups
  const anchors = docsConfig.navigation.anchors.filter(anchor => anchor.groups);

  if (anchors.length === 0) {
    console.error('No anchors with groups found in docs.json');
    return;
  }

  let content = `# LangWatch

This is the full index of LangWatch documentation, to answer the user question, do not use just this file, first explore the urls that make sense using the markdown navigation links below to understand how to implement LangWatch and use specific features.
Always navigate to docs links using the .md extension for better readability.

`;

  // Custom ordering: Documentation first, but split to insert Integrations after Observability
  const docAnchor = anchors.find(a => a.anchor === 'Documentation');
  const integrationsAnchor = anchors.find(a => a.anchor === 'Integrations');
  const selfHostingAnchor = anchors.find(a => a.anchor === 'Self Hosting');
  const apiRefAnchor = anchors.find(a => a.anchor === 'API Reference');

  // Process Documentation anchor groups, but insert Integrations after Observability
  if (docAnchor) {
    docAnchor.groups.forEach((group, groupIndex) => {
      content += `## ${group.group}\n\n`;
      const lines = processNavigationPages(group.pages);
      content += lines.join('\n');

      // After Observability group, insert the entire Integrations section
      if (group.group === 'Observability' && integrationsAnchor) {
        content += '\n\n# Integrations\n\n';
        integrationsAnchor.groups.forEach((intGroup, intGroupIndex) => {
          content += `## ${intGroup.group}\n\n`;
          const intLines = processNavigationPages(intGroup.pages);
          content += intLines.join('\n');

          if (intGroupIndex < integrationsAnchor.groups.length - 1) {
            content += '\n\n';
          }
        });
      }

      // Add spacing between groups
      if (groupIndex < docAnchor.groups.length - 1) {
        content += '\n\n';
      }
    });
  }

  // Add remaining anchors (Self Hosting, API Reference)
  const remainingAnchors = [selfHostingAnchor, apiRefAnchor].filter(Boolean);

  if (remainingAnchors.length > 0) {
    content += '\n\n';
  }

  remainingAnchors.forEach((anchor, anchorIndex) => {
    if (anchor.anchor) {
      content += `# ${anchor.anchor}\n\n`;
    }

    anchor.groups.forEach((group, groupIndex) => {
      content += `## ${group.group}\n\n`;
      const lines = processNavigationPages(group.pages);
      content += lines.join('\n');

      const isLastGroup = groupIndex === anchor.groups.length - 1;
      const isLastAnchor = anchorIndex === remainingAnchors.length - 1;

      if (!isLastGroup || !isLastAnchor) {
        content += '\n\n';
      } else {
        content += '\n';
      }
    });
  });

  // Remove trailing newlines and add single newline at end
  content = content.replace(/\n\n+$/, '\n');

  fs.writeFileSync(rootOutputFile, content);
  console.log(`Root llms.txt file generated: ${rootOutputFile}`);
}

// Function to process imports in an MDX file
function processImports(content, filePath) {
  // Find all import statements
  const importRegex = /import\s+(\w+)\s+from\s+["']([^"']+)["'];?/g;
  let modifiedContent = content;
  const imports = {};

  // Extract all imports
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const importName = match[1];
    const importPath = match[2];

    // Handle only imports from /snippets
    if (importPath.startsWith('/snippets/')) {
      const absoluteImportPath = path.join(process.cwd(), importPath.substring(1));

      try {
        if (fs.existsSync(absoluteImportPath)) {
          // Read the imported file
          const importedContent = fs.readFileSync(absoluteImportPath, 'utf8');
          imports[importName] = importedContent;
          if (importName == "LLMsTxtProtip") {
            imports[importName] = ""
          }
        } else {
          console.warn(`Warning: Import file not found: ${absoluteImportPath}`);
        }
      } catch (err) {
        console.error(`Error reading import file ${absoluteImportPath}: ${err.message}`);
      }
    }
  }

  // Replace component references with their content
  Object.keys(imports).forEach(componentName => {
    // Simple replacement for <ComponentName /> pattern
    const componentRegex = new RegExp(`<${componentName}\\s*\\/>`, 'g');
    modifiedContent = modifiedContent.replace(componentRegex, imports[componentName]);
  });

  // Remove import statements
  modifiedContent = modifiedContent.replace(importRegex, '');

  // Replace <Tab title="X"> with ### X
  modifiedContent = modifiedContent.replace(/<Tab\s+title="([^"]+)">/g, '### $1\n');

  // Remove </Tab> tags
  modifiedContent = modifiedContent.replace(/<\/Tab>/g, '');

  // Remove <Tabs> and </Tabs> tags
  modifiedContent = modifiedContent.replace(/<Tabs>|<\/Tabs>/g, '');

  // Remove too many sequential newlines
  modifiedContent = modifiedContent.replace(/\n\n\n\n+/g, '\n\n');

  return modifiedContent;
}

// Process each include path
includePaths.forEach(includePath => {
  try {
    // Create a find command to locate the files
    let findCmd = `find . -type f -path "./${includePath}" 2>/dev/null || echo ""`;

    // Add exclude patterns if any
    if (excludePaths.length > 0) {
      excludePaths.forEach(excludePath => {
        findCmd += ` | grep -v "${excludePath}"`;
      });
    }

    // Execute the find command
    const files = execSync(findCmd)
      .toString()
      .trim()
      .split('\n')
      .filter(file => file); // Remove empty lines

    // Process each matching file
    files.forEach(file => {
      console.log(`Processing: ${file}`);
      try {
        let content = fs.readFileSync(file, 'utf8');

        // Process imports for MDX files
        if (file.endsWith('.mdx')) {
          content = processImports(content, file);
        }

        // Remove trailing whitespaces
        content = content.replace(/[ \t]+$/gm, '');

        // Append to output file
        fs.appendFileSync(outputFile, `# FILE: ${file}\n\n`);
        fs.appendFileSync(outputFile, content);
        fs.appendFileSync(outputFile, '\n---\n\n');
      } catch (err) {
        console.error(`Error reading ${file}: ${err.message}`);
      }
    });
  } catch (error) {
    // If there's an error with the command, log and continue
    console.log(`Error with pattern: ${includePath}: ${error.message}`);
  }
});

// Remove extra blank line at EOF
let finalContent = fs.readFileSync(outputFile, 'utf8');
if (finalContent.endsWith('\n\n')) {
  finalContent = finalContent.substring(0, finalContent.length - 1);
  fs.writeFileSync(outputFile, finalContent);
}

console.log(`Done! All matching files have been merged into ${outputFile}`);

// Generate the root llms.txt file
generateRootLlmsTxt();
