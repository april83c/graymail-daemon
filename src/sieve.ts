const GRAYMAIL_BEGIN = "# GRAYMAIL-BEGIN";
const GRAYMAIL_END = "# GRAYMAIL-END";
const ALLOW_BEGIN = "# GRAYMAIL-ALLOW-BEGIN";
const ALLOW_END = "# GRAYMAIL-ALLOW-END";

interface Addresses {
  exact: string[];
  domains: string[];
}

interface BlockLocation {
  addrs: Addresses;
  beginIdx: number;
  endIdx: number;
}

function parseAddresses(block: string): Addresses {
  const result: Addresses = { exact: [], domains: [] };

  const exactMatch = block.match(
    /address\s+:all\s+:is\s+"from"\s+\[([\s\S]*?)\]/,
  );
  if (exactMatch) {
    for (const m of exactMatch[1].matchAll(/"([^"]+)"/g)) {
      result.exact.push(m[1].toLowerCase());
    }
  }

  const domainMatch = block.match(
    /address\s+:domain\s+:is\s+"from"\s+\[([\s\S]*?)\]/,
  );
  if (domainMatch) {
    for (const m of domainMatch[1].matchAll(/"([^"]+)"/g)) {
      result.domains.push(m[1].toLowerCase());
    }
  }

  return result;
}

function findBlock(
  script: string,
  begin: string,
  end: string,
): BlockLocation | null {
  const beginIdx = script.indexOf(begin);
  const endIdx = script.indexOf(end);
  if (beginIdx === -1 || endIdx === -1) return null;

  const endMarkerEnd = endIdx + end.length;
  const block = script.substring(beginIdx, endMarkerEnd);

  return { addrs: parseAddresses(block), beginIdx, endIdx: endMarkerEnd };
}

function generateBlock(
  addrs: Addresses,
  begin: string,
  end: string,
  bodyLines: string[],
): string {
  if (addrs.exact.length === 0 && addrs.domains.length === 0) {
    return `${begin}\n${end}`;
  }

  const needsAnyof = addrs.exact.length > 0 && addrs.domains.length > 0;
  const indent = needsAnyof ? "    " : "  ";
  const closingIndent = needsAnyof ? "  " : "";

  const conditions: string[] = [];

  if (addrs.exact.length > 0) {
    const list = addrs.exact.map((a) => `${indent}"${a}"`).join(",\n");
    conditions.push(
      `  address :all :is "from" [\n${list}\n${closingIndent}]`,
    );
  }

  if (addrs.domains.length > 0) {
    const list = addrs.domains.map((d) => `${indent}"${d}"`).join(",\n");
    conditions.push(
      `  address :domain :is "from" [\n${list}\n${closingIndent}]`,
    );
  }

  let test: string;
  if (needsAnyof) {
    test = `anyof (\n${conditions.join(",\n")}\n)`;
  } else {
    test = conditions[0].trimStart();
  }

  return [begin, `if ${test} {`, ...bodyLines.map((l) => `  ${l}`), "}", end].join(
    "\n",
  );
}

function replaceBlock(
  script: string,
  loc: BlockLocation,
  newBlock: string,
): string {
  return (
    script.substring(0, loc.beginIdx) + newBlock + script.substring(loc.endIdx)
  );
}

export interface SieveChanges {
  graymailAdd?: string[];
  graymailRemove?: string[];
  allowAdd?: string[];
}

export function updateSieveScript(
  script: string,
  changes: SieveChanges,
  folder: string,
): string {
  let result = script;

  // Allow block (processed first so graymail block indices stay valid when re-parsed)
  const hasAllowChanges = changes.allowAdd && changes.allowAdd.length > 0;
  if (hasAllowChanges) {
    const loc = findBlock(result, ALLOW_BEGIN, ALLOW_END);
    if (!loc) {
      throw new Error(
        `Sieve script is missing ${ALLOW_BEGIN} / ${ALLOW_END} markers`,
      );
    }

    const existing = new Set(loc.addrs.exact);
    let changed = false;
    for (const addr of changes.allowAdd!) {
      const lower = addr.toLowerCase();
      if (!existing.has(lower)) {
        loc.addrs.exact.push(lower);
        existing.add(lower);
        changed = true;
      }
    }

    if (changed) {
      result = replaceBlock(
        result,
        loc,
        generateBlock(loc.addrs, ALLOW_BEGIN, ALLOW_END, ["stop;"]),
      );
    }
  }

  // Graymail block (re-find on potentially updated script)
  const gLoc = findBlock(result, GRAYMAIL_BEGIN, GRAYMAIL_END);
  if (!gLoc) {
    throw new Error(
      `Sieve script is missing ${GRAYMAIL_BEGIN} / ${GRAYMAIL_END} markers`,
    );
  }

  let gChanged = false;

  if (changes.graymailAdd && changes.graymailAdd.length > 0) {
    const existing = new Set(gLoc.addrs.exact);
    for (const addr of changes.graymailAdd) {
      const lower = addr.toLowerCase();
      if (!existing.has(lower)) {
        gLoc.addrs.exact.push(lower);
        existing.add(lower);
        gChanged = true;
      }
    }
  }

  if (changes.graymailRemove && changes.graymailRemove.length > 0) {
    const removeSet = new Set(
      changes.graymailRemove.map((a) => a.toLowerCase()),
    );
    const before = gLoc.addrs.exact.length;
    gLoc.addrs.exact = gLoc.addrs.exact.filter((a) => !removeSet.has(a));
    if (gLoc.addrs.exact.length !== before) gChanged = true;
  }

  if (gChanged) {
    result = replaceBlock(
      result,
      gLoc,
      generateBlock(gLoc.addrs, GRAYMAIL_BEGIN, GRAYMAIL_END, [
        `fileinto :create "${folder}";`,
        "stop;",
      ]),
    );
  }

  return result;
}
