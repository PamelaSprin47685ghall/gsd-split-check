const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function splitFrontmatter(document) {
  const match = document.match(FRONTMATTER_RE);
  if (!match) {
    return { hasFrontmatter: false, frontmatterText: "", body: document };
  }

  return {
    hasFrontmatter: true,
    frontmatterText: match[1],
    body: document.slice(match[0].length),
  };
}

export function frontmatterHasBoolean(frontmatterText, key) {
  const lineRe = new RegExp(`^${escapeRegExp(key)}\\s*:\\s*true\\s*$`, "im");
  return lineRe.test(frontmatterText);
}

export function documentHasBoolean(document, key) {
  return frontmatterHasBoolean(splitFrontmatter(document).frontmatterText, key);
}

export function setBooleanFrontmatter(document, key, value) {
  const parsed = splitFrontmatter(document);
  const nextLine = `${key}: ${value ? "true" : "false"}`;

  if (!parsed.hasFrontmatter) {
    const body = document.replace(/^\r?\n+/, "");
    return [`---`, nextLine, `---`, "", body].join("\n");
  }

  const lines = parsed.frontmatterText.split(/\r?\n/);
  let replaced = false;
  const next = lines.map((line) => {
    if (new RegExp(`^${escapeRegExp(key)}\\s*:`, "i").test(line.trim())) {
      replaced = true;
      return nextLine;
    }
    return line;
  });

  if (!replaced) next.push(nextLine);

  const body = parsed.body.replace(/^\r?\n+/, "");
  return [`---`, next.join("\n"), `---`, "", body].join("\n");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
